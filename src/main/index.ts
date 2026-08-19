import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { hostname } from 'os'

function getWindowIcon(): string | undefined {
  if (process.platform === 'win32') return join(app.getAppPath(), 'images/windows/icon.ico')
  if (process.platform === 'linux') return join(app.getAppPath(), 'images/linux/icons/256x256.png')
  return undefined
}
import { execSync } from 'child_process'
import { loadConfig, saveConfig, getConfigPath, getInstallationId } from './config'
import { Logger } from './service/logger'
import { ConnectService } from './service/connect-service'
import { sessionManager } from './service/session-manager'
import { discoverServerTools } from './service/mcp-client'
import { installBrowser, isBrowserInstalled } from './playwright'
import { DEEP_LINK_PROTOCOL, parseDeepLink, extractDeepLinkUrl } from './deep-link'
import { IPC_TO_MAIN, IPC_TO_RENDERER } from '../shared/ipc-types'
import type { AppConfig, ServerConfig, DeepLinkConfigPayload } from '../shared/ipc-types'

// Only one instance may run — deep links delivered to a second launch must
// reach the already-running window instead of spawning a duplicate app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

// Extend PATH so that `npx` and other tools are found when the app is packaged
if (process.platform !== 'win32') {
  try {
    process.env.PATH = execSync('/bin/zsh -lc "echo $PATH"').toString().trim()
  } catch {
    // fall through — system PATH used as fallback
  }
}

let mainWindow: BrowserWindow | null = null
let pendingDeepLink: DeepLinkConfigPayload | null = null

// Module scope so deep-link handling can reach them too, not just the IPC layer.
const logger = new Logger(() => mainWindow)
const service = new ConnectService(logger)

// Nothing awaits this — the OS handlers below are synchronous — so failures are
// logged here rather than surfacing as an unhandled rejection.
function handleDeepLink(rawUrl: string): void {
  applyDeepLink(rawUrl).catch((e) => {
    logger.error(`Deep link failed: ${e instanceof Error ? e.message : String(e)}`)
  })
}

async function applyDeepLink(rawUrl: string): Promise<void> {
  const parsed = parseDeepLink(rawUrl)
  if (!parsed) return

  const payload = parsed.code ? await quickConnect(parsed) : parsed
  if (!payload) return

  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(IPC_TO_RENDERER.DEEP_LINK_CONFIG, payload)
    mainWindow.show()
    mainWindow.focus()
  } else {
    pendingDeepLink = payload
  }
}

// A deep link can be triggered by any web page, so nothing is applied until the
// person at the machine confirms it — otherwise a random site could quietly
// re-point this machine at its own installation.
async function quickConnect(payload: DeepLinkConfigPayload): Promise<DeepLinkConfigPayload | null> {
  const current = loadConfig()
  const target = new URL(payload.exchangeUrl!).host
  const urlChange =
    current?.deployment_url && current.deployment_url !== payload.deploymentUrl
      ? `\n\nDeployment URL: ${payload.deploymentUrl}\n(currently ${current.deployment_url})`
      : `\n\nDeployment URL: ${payload.deploymentUrl}`

  mainWindow?.show()
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Connect'],
    defaultId: 1,
    cancelId: 0,
    message: `Connect this machine to ${target}?`,
    detail: `Any previous connection of this machine will be replaced.${urlChange}`,
  })
  if (response !== 1) return null

  try {
    const token = await redeemCode(payload)
    const config: AppConfig = {
      ...(loadConfig() ?? { deployment_url: '', servers: {} }),
      deployment_url: payload.deploymentUrl,
      auth_token: token,
    }
    saveConfig(config)
    if (service.isRunning()) await service.stop()
    await service.start(config)
    logger.info(`Configured by ${target} — machine is ready to connect.`)
    return { deploymentUrl: payload.deploymentUrl, authToken: token }
  } catch (e) {
    // Leave the existing configuration alone: a failed exchange must never cost
    // the user a working setup.
    const reason = e instanceof Error ? e.message : String(e)
    logger.error(`Quick connect failed: ${reason}`)
    dialog.showErrorBox('Could not connect', `${reason}\n\nThe existing configuration was left unchanged.`)
    return null
  }
}

async function redeemCode(payload: DeepLinkConfigPayload): Promise<string> {
  const response = await fetch(payload.exchangeUrl!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: payload.code,
      connect_app_id: getInstallationId(),
      display_name: hostname(),
    }),
  })

  if (!response.ok) {
    throw new Error(
      response.status === 422
        ? 'The link has expired — click "Connect app" again.'
        : `The deployment answered ${response.status}.`,
    )
  }

  const body = (await response.json()) as { token?: string; deployment_url?: string }
  if (!body.token) throw new Error('The deployment did not return a token.')
  if (body.deployment_url && body.deployment_url !== payload.deploymentUrl) {
    logger.info(`Deployment reports a different gateway URL (${body.deployment_url}); keeping the confirmed one.`)
  }
  return body.token
}

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

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      mainWindow?.webContents.send(IPC_TO_RENDERER.DEEP_LINK_CONFIG, pendingDeepLink)
      pendingDeepLink = null
    }
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
  ipcMain.handle(IPC_TO_MAIN.CONFIG_LOAD, (): AppConfig | null => {
    return loadConfig()
  })

  // Exposed so the UI can show the machine's Client ID before it ever connects
  // — you need it to generate a handshake token in workflow.
  ipcMain.handle(IPC_TO_MAIN.GET_INSTALLATION_ID, (): string => {
    return getInstallationId()
  })

  ipcMain.handle(IPC_TO_MAIN.APP_GET_VERSION, (): string => {
    return app.isPackaged ? app.getVersion() : 'dev'
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

// macOS delivers deep links via 'open-url' instead of argv; register before
// whenReady since it can fire while the app is still launching.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

// Windows/Linux "already running" case: the OS relaunches the exe with the
// URL as an argv entry, and requestSingleInstanceLock funnels it here.
app.on('second-instance', (_event, argv) => {
  const url = extractDeepLinkUrl(argv)
  if (url) handleDeepLink(url)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(app.getAppPath(), 'images/macos/1024x1024.png'))
  }

  if (process.platform === 'win32' && !app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
      join(__dirname, '../../out/main/index.js'),
    ])
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)
  }

  createWindow()
  registerIpcHandlers()

  // Windows/Linux cold-launch: no other instance was running (so
  // 'second-instance' never fired) and it's not macOS (so 'open-url' never
  // fires) — the URL only arrives via this process's own argv.
  const initialUrl = extractDeepLinkUrl(process.argv)
  if (initialUrl) handleDeepLink(initialUrl)

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
