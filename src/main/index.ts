import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'

function getWindowIcon(): string | undefined {
  if (process.platform === 'win32') return join(app.getAppPath(), 'images/windows/icon.ico')
  if (process.platform === 'linux') return join(app.getAppPath(), 'images/linux/icons/256x256.png')
  return undefined
}
import { execSync } from 'child_process'
import { loadConfig, saveConfig, getConfigPath } from './config'
import { Logger } from './service/logger'
import { ConnectService } from './service/connect-service'
import { sessionManager } from './service/session-manager'
import { discoverServerTools } from './service/mcp-client'
import { installBrowser, isBrowserInstalled } from './playwright'
import { IPC_TO_MAIN, IPC_TO_RENDERER } from '../shared/ipc-types'
import type { AppConfig, ServerConfig } from '../shared/ipc-types'

// Extend PATH so that `npx` and other tools are found when the app is packaged
if (process.platform !== 'win32') {
  try {
    process.env.PATH = execSync('/bin/zsh -lc "echo $PATH"').toString().trim()
  } catch {
    // fall through — system PATH used as fallback
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'Agentic QA - connect',
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: getWindowIcon(),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  const logger = new Logger(() => mainWindow)
  const service = new ConnectService(logger)

  ipcMain.handle(IPC_TO_MAIN.CONFIG_LOAD, (): AppConfig | null => {
    return loadConfig()
  })

  ipcMain.handle(IPC_TO_MAIN.CONFIG_SAVE, (_event, config: AppConfig): void => {
    try {
      saveConfig(config)
    } catch (e) {
      throw new Error(`Could not write config: ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  ipcMain.handle(IPC_TO_MAIN.SERVICE_START, async (): Promise<void> => {
    const config = loadConfig()
    if (!config) throw new Error('No configuration found. Please save your config first.')
    if (!config.deployment_url) throw new Error('deployment_url is required in config.')
    logger.setConnected(false, config.deployment_url)
    await service.start(config)
  })

  ipcMain.handle(IPC_TO_MAIN.SERVICE_STOP, async (): Promise<void> => {
    await service.stop()
    logger.setConnected(false)
  })

  ipcMain.handle(IPC_TO_MAIN.SESSION_RESET, (): void => {
    logger.reset()
  })

  ipcMain.handle(
    IPC_TO_MAIN.SERVER_TEST,
    async (_event, name: string, conf: ServerConfig): Promise<{ ok: boolean; toolCount: number; error?: string }> => {
      try {
        const info = await discoverServerTools(name, conf)
        return { ok: true, toolCount: info.tools.length }
      } catch (e) {
        return { ok: false, toolCount: 0, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  ipcMain.handle(IPC_TO_MAIN.CONFIG_OPEN_FILE, async (): Promise<void> => {
    const configPath = getConfigPath()
    const { mkdirSync, writeFileSync, existsSync } = await import('fs')
    const { dirname } = await import('path')
    if (!existsSync(configPath)) {
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(configPath, JSON.stringify({ deployment_url: '', servers: {} }, null, 2))
    }
    const err = await shell.openPath(configPath)
    if (err) {
      dialog.showErrorBox('Could not open config file', err)
    }
  })

  ipcMain.handle(IPC_TO_MAIN.PLAYWRIGHT_CHECK, (_event, browser: string): boolean => {
    return isBrowserInstalled(browser)
  })

  ipcMain.handle(IPC_TO_MAIN.PLAYWRIGHT_INSTALL, async (_event, browser: string, sudoPassword?: string): Promise<void> => {
    await installBrowser(browser, (line) => {
      mainWindow?.webContents.send(IPC_TO_RENDERER.PLAYWRIGHT_INSTALL_PROGRESS, line)
    }, sudoPassword)
  })
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(app.getAppPath(), 'images/macos/1024x1024.png'))
  }
  createWindow()
  registerIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  sessionManager.cleanupAll().catch(() => {})
})
