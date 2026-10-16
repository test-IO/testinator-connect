import type { InstallDecision } from '../../shared/ipc-types'

export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdaterEnvironment {
  isPackaged: boolean
  platform: NodeJS.Platform
  macSigned: boolean
  autoUpdateEnabled: boolean
}

// Squirrel.Mac refuses to apply updates to an app without a Developer ID signature.
export function isUpdaterEnabled(env: UpdaterEnvironment): boolean {
  if (!env.isPackaged || !env.autoUpdateEnabled) return false
  if (env.platform === 'win32') return true
  if (env.platform === 'darwin') return env.macSigned
  return false
}

export function canInstallNow(activeSessions: number): InstallDecision {
  if (activeSessions === 0) return { ok: true }
  const subject = activeSessions === 1 ? '1 test session is' : `${activeSessions} test sessions are`
  return {
    ok: false,
    reason: `${subject} running. Restart after it finishes — the update also installs when you quit the app.`,
  }
}
