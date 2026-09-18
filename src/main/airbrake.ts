import { app } from 'electron'
import { Notifier } from '@airbrake/node'

const projectId = Number(import.meta.env.AIRBRAKE_PROJECT_ID)
const projectKey = import.meta.env.AIRBRAKE_PROJECT_KEY

// Config is baked in at build time (see electron.vite.config.ts + .env.local.example).
// A local dev build with no .env simply runs without error reporting.
export const airbrake =
  projectId && projectKey
    ? new Notifier({
        projectId,
        projectKey,
        environment: app.isPackaged ? 'production' : 'development',
      })
    : null

export function initAirbrake(): void {
  if (!airbrake) return

  process.on('uncaughtException', (error) => {
    airbrake.notify(error)
  })
  process.on('unhandledRejection', (reason) => {
    airbrake.notify(reason instanceof Error ? reason : new Error(String(reason)))
  })
}
