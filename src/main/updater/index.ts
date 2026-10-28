import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC_TO_RENDERER } from '../../shared/ipc-types'
import type { InstallDecision, UpdateState } from '../../shared/ipc-types'
import type { Logger } from '../service/logger'
import { CHECK_INTERVAL_MS, canInstallNow, isUpdaterEnabled, upToDateMessage } from './policy'
import { INITIAL_UPDATE_STATE, reduceUpdateState } from './update-state'
import type { UpdaterEvent } from './update-state'

export interface UpdaterDeps {
  getWindow: () => BrowserWindow | null
  getActiveSessionCount: () => number
  logger: Logger
}

export interface Updater {
  getState: () => UpdateState
  checkNow: (manual?: boolean) => Promise<void>
  install: () => InstallDecision
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const enabled = isUpdaterEnabled({
    isPackaged: app.isPackaged,
    platform: process.platform,
    macSigned: import.meta.env.MAIN_VITE_MAC_SIGNED === 'true',
    // Emergency switch: a release built with MAIN_VITE_AUTO_UPDATE=false stays on its version.
    autoUpdateEnabled: import.meta.env.MAIN_VITE_AUTO_UPDATE !== 'false',
  })
  let state: UpdateState = enabled ? INITIAL_UPDATE_STATE : { status: 'disabled' }

  const apply = (event: UpdaterEvent): void => {
    state = reduceUpdateState(state, event)
    const win = deps.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC_TO_RENDERER.UPDATE_STATE, state)
  }

  // Only a check the user started logs "Up to date"; background checks stay quiet.
  let manualCheck = false

  const checkNow = async (manual = false): Promise<void> => {
    if (!enabled) return
    manualCheck = manual
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      apply({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  if (enabled) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    // Only electron-updater's warnings and errors reach the app log; its info lines confuse users.
    autoUpdater.logger = {
      info: () => {},
      warn: (m) => deps.logger.warning(`[updater] ${String(m)}`),
      error: (m) => deps.logger.error(`[updater] ${String(m)}`),
    }

    autoUpdater.on('checking-for-update', () => apply({ type: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      deps.logger.info(`Update ${info.version} available — downloading in the background`)
      apply({ type: 'available', version: info.version })
    })
    autoUpdater.on('update-not-available', () => {
      if (manualCheck) deps.logger.info(upToDateMessage(app.getVersion()))
      manualCheck = false
      apply({ type: 'not-available' })
    })
    autoUpdater.on('download-progress', (progress) => apply({ type: 'progress', percent: progress.percent }))
    autoUpdater.on('update-downloaded', (info) => {
      deps.logger.success(`Update ${info.version} downloaded — restart to install`)
      apply({ type: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (err) => {
      deps.logger.warning(`Update check failed: ${err.message}`)
      apply({ type: 'error', message: err.message })
    })

    void checkNow()
    setInterval(() => void checkNow(), CHECK_INTERVAL_MS)
  }

  return {
    getState: () => state,
    checkNow,
    install: () => {
      if (state.status !== 'downloaded') return { ok: false, reason: 'No update is ready to install yet.' }
      const decision = canInstallNow(deps.getActiveSessionCount())
      if (decision.ok) {
        // Silent install into the existing location, then relaunch.
        setImmediate(() => {
          try {
            autoUpdater.quitAndInstall(true, true)
          } catch (e) {
            deps.logger.error(`Update install failed: ${e instanceof Error ? e.message : String(e)}`)
          }
        })
      }
      return decision
    },
  }
}
