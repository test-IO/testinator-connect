// Headless CLI mode: `AgenticQAConnect.exe --cli --config <path>` starts the
// same Socket.IO + MCP-discovery service the GUI's Start button does, with no
// BrowserWindow, no IPC, no deep-link handling — just stdout logging. This is
// still an Electron process (not a plain Node script) so it can reuse
// config.ts/uv.ts/playwright.ts's `app.getPath()`/`app.isPackaged` resource
// resolution unchanged; it just never calls createWindow(). Meant for
// unattended startup (Windows Task Scheduler, a systemd unit, a login-item
// shortcut) in place of running `npm run dev` in an open terminal.
//
// The config file passed via --config is the same AppConfig shape the GUI
// saves (deployment_url, auth_token, servers, ...) — including the optional
// `installation_id` override (see config.ts) for provisioning a machine with
// a pre-approved client id rather than letting one be generated on first run.
import { app } from 'electron'
import * as path from 'path'
import { loadConfig } from './config'
import { Logger, type LogSink } from './service/logger'
import { ConnectService } from './service/connect-service'
import { sessionManager } from './service/session-manager'
import { IPC_TO_RENDERER } from '../shared/ipc-types'
import type { LogEntry } from '../shared/ipc-types'

export interface CliArgs {
  cli: boolean
  configPath?: string
}

export function parseCliArgs(argv: string[]): CliArgs {
  const cli = argv.includes('--cli') || argv.includes('--headless')
  const idx = argv.indexOf('--config')
  // CONNECT_CONFIG_PATH exists because `npm run cli -- --config <path>` isn't
  // reliable on Windows: some npm/argv-forwarding stacks there silently drop
  // the literal token `--config` while still forwarding its value, even past
  // the `--` separator — observed with a real npm-on-Windows install, not a
  // quoting mistake on the caller's end. The env var sidesteps npm's argv
  // handling entirely, since it never has to survive being forwarded through
  // `npm run`'s own arg parser.
  const configPath = idx !== -1 ? argv[idx + 1] : process.env.CONNECT_CONFIG_PATH
  return { cli, configPath }
}

// Plain-text stdout sink — same events the renderer's ActivityLog subscribes
// to, minus anything only meaningful to a UI (session table rows, tool list
// panels). One line per event keeps this greppable/log-shippable as-is.
const consoleSink: LogSink = (channel, payload) => {
  const ts = new Date().toISOString()
  switch (channel) {
    case IPC_TO_RENDERER.LOG_ENTRY: {
      const entry = payload as LogEntry
      console.log(`[${ts}] ${entry.level.toUpperCase()} ${entry.message}`)
      break
    }
    case IPC_TO_RENDERER.STATUS_CHANGED: {
      const status = payload as {
        connected: boolean
        connecting: boolean
        deploymentUrl?: string
        connectionError?: string | null
      }
      if (status.connectionError) {
        console.log(`[${ts}] STATUS error: ${status.connectionError}`)
      } else {
        console.log(
          `[${ts}] STATUS connected=${status.connected} connecting=${status.connecting}` +
            (status.deploymentUrl ? ` url=${status.deploymentUrl}` : ''),
        )
      }
      break
    }
    case IPC_TO_RENDERER.TOOLS_UPDATED: {
      const tools = payload as Array<{ server: string; name: string }>
      console.log(`[${ts}] TOOLS ${tools.length} tools available`)
      break
    }
    default:
      // Session/tool-call/resource-call events are visible via LOG_ENTRY
      // already (Logger emits both); no need to duplicate them here.
      break
  }
}

async function shutdown(service: ConnectService, exitCode: number): Promise<void> {
  await service.stop()
  await sessionManager.cleanupAll()
  process.exitCode = exitCode
  app.quit()
}

export async function runCli(args: CliArgs): Promise<void> {
  const logger = new Logger(consoleSink)
  const service = new ConnectService(logger)

  // Resolved against cwd (not electron's own resource paths) so a relative
  // --config behaves the way it looks like it should from the shell that
  // invoked this — and so the error below names an unambiguous path instead
  // of the raw arg, which is what actually matters once something's wrong.
  const resolvedConfigPath = args.configPath ? path.resolve(process.cwd(), args.configPath) : undefined
  const config = loadConfig(resolvedConfigPath)
  if (!config) {
    // loadConfig already logged the parse error, if any, to console.error —
    // this covers the missing-file / missing-flag cases it can't tell apart
    // from a malformed file on its own.
    console.error(
      resolvedConfigPath
        ? `No config found at ${resolvedConfigPath}`
        : 'No config found. Pass --config <path> or save one via the GUI first.',
    )
    process.exitCode = 1
    app.quit()
    return
  }
  if (!config.deployment_url) {
    console.error('deployment_url is required in the config file.')
    process.exitCode = 1
    app.quit()
    return
  }

  process.on('SIGINT', () => void shutdown(service, 0))
  process.on('SIGTERM', () => void shutdown(service, 0))

  logger.setConnecting(config.deployment_url)
  try {
    await service.start(config)
  } catch (e) {
    console.error(`Failed to start: ${e instanceof Error ? e.message : String(e)}`)
    await shutdown(service, 1)
  }
  // No further await here — the process stays alive on Electron's own event
  // loop (Socket.IO's socket keeps a live handle) until SIGINT/SIGTERM.
}
