import { app } from 'electron'
import { Notifier } from '@airbrake/node'
import { getInstallationId } from './config'
import type { ServerConfig } from '../shared/ipc-types'

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

  // Read lazily inside the filter (not at module load) since getInstallationId()
  // touches app.getPath, which isn't safe to call before the app is ready.
  airbrake.addFilter((notice) => {
    notice.context = {
      ...notice.context,
      installationId: getInstallationId(),
      platform: process.platform,
    }
    return notice
  })

  process.on('uncaughtException', (error) => {
    airbrake.notify(error)
  })
  process.on('unhandledRejection', (reason) => {
    airbrake.notify(reason instanceof Error ? reason : new Error(String(reason)))
  })
}

export type McpErrorOperation =
  | 'discover'
  | 'server_test'
  | 'session_start'
  | 'tool_call'
  | 'resource_read'
  | 'unknown_server'

export interface McpErrorContext {
  operation: McpErrorOperation
  serverName: string
  conf?: ServerConfig
  // Names configured on this machine, to spot name/case mismatches with the caller.
  configuredServers?: string[]
  toolName?: string
  sessionId?: string
}

const SECRET_FLAG = /token|key|secret|password|passwd|auth|credential/i

// Args and headers may carry secrets: keep flag names, drop the values that follow
// secret-looking ones (`--api-key abc`, `--token=abc`, `KEY=abc`).
function redactArgs(args: string[]): string[] {
  const out: string[] = []
  let redactNext = false
  for (const arg of args) {
    if (redactNext) {
      out.push('[redacted]')
      redactNext = false
      continue
    }
    const eq = arg.indexOf('=')
    if (eq > 0 && SECRET_FLAG.test(arg.slice(0, eq))) {
      out.push(`${arg.slice(0, eq)}=[redacted]`)
    } else if (arg.startsWith('-') && eq === -1 && SECRET_FLAG.test(arg)) {
      out.push(arg)
      redactNext = true
    } else {
      out.push(arg)
    }
  }
  return out
}

// Reports a failure talking to an MCP server, with enough context (server, command, args,
// transport, resolved launch command, stderr tail already inside the message) to diagnose
// problems we cannot reproduce on another machine. Never throws.
export function reportMcpError(error: unknown, ctx: McpErrorContext): void {
  if (!airbrake) return
  try {
    const err = error instanceof Error ? error : new Error(String(error))
    const conf = ctx.conf
    airbrake.notify({
      error: err,
      context: {
        component: `mcp:${ctx.operation}`,
        mcpOperation: ctx.operation,
        mcpServer: ctx.serverName,
        mcpTool: ctx.toolName,
        sessionId: ctx.sessionId,
        appVersion: app.getVersion(),
        osRelease: process.getSystemVersion?.() ?? process.platform,
        arch: process.arch,
      },
      params: {
        server: conf && {
          type: conf.type ?? 'stdio',
          command: conf.command,
          args: conf.args ? redactArgs(conf.args) : undefined,
          url: conf.url ? conf.url.replace(/\/\/[^/@]*@/, '//[redacted]@').split('?')[0] : undefined,
          stateful: conf.stateful ?? false,
          headerNames: conf.headers ? Object.keys(conf.headers) : undefined,
        },
        configuredServers: ctx.configuredServers,
      },
    })
  } catch {
    // Reporting must never break the caller.
  }
}
