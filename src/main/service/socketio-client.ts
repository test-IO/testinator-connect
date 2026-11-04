import { hostname } from 'os'
import { io, type Socket } from 'socket.io-client'
import type { AppConfig, ServerConfig } from '../../shared/ipc-types'
import {
  discoverServer,
  discoverServerTools,
  stderrOfResult,
  type ServerToolInfo,
  type ServerResourceInfo,
  type ServerDiscoveryResult,
} from './mcp-client'
import { sessionManager } from './session-manager'
import { getInstallationId } from '../config'
import type { Logger } from './logger'
import { reportMcpError, reportMcpToolFailure } from '../airbrake'
import { describeToolFailure } from '../mcp-tool-failure'

// After the final attempt fails, the machine stays disconnected until the user
// restarts the app. The limit therefore has to cover a Gateway restart, not
// just a short network interruption. The delay is capped at 5 seconds, so the
// backoff reaches that cap after a few attempts, and 15 attempts cover about a
// minute, which is long enough for a rolling deployment to finish.
const RECONNECTION_ATTEMPTS = 15

// The platform names a server by its canonical name (e.g. the `windows_mcp` driver), but the
// user's config key is free text: `Windows_mcp` and `windows_mcp` are the same server to a
// human. Exact match wins; otherwise accept a single case-insensitive match.
function resolveServer(
  servers: Record<string, ServerConfig>,
  requested: string,
): [string, ServerConfig] | undefined {
  if (servers[requested]) return [requested, servers[requested]]
  const wanted = requested.toLowerCase()
  const matches = Object.keys(servers).filter((n) => n.toLowerCase() === wanted)
  return matches.length === 1 ? [matches[0], servers[matches[0]]] : undefined
}

function buildToolkitConfigs(
  allTools: ServerToolInfo[],
  allResources: ServerResourceInfo[],
): Array<{ name: string; tools: Array<unknown>; resources: Array<unknown> }> {
  const resourceMap = new Map(allResources.map((s) => [s.name, s.resources ?? []]))

  return allTools.map((server) => {
    const rawResources = resourceMap.get(server.name) ?? []
    return {
      name: server.name ?? '',
      tools: (server.tools ?? []).map((tool) => {
        const rawSchema = (tool.inputSchema ?? {}) as Record<string, unknown>
        const properties =
          typeof rawSchema.properties === 'object' && rawSchema.properties !== null
            ? rawSchema.properties
            : {}
        const required = Array.isArray(rawSchema.required) ? rawSchema.required : []
        return {
          name: tool.name ?? '',
          description: tool.description ?? '',
          inputSchema: {
            type: typeof rawSchema.type === 'string' ? rawSchema.type : 'object',
            properties,
            required,
          },
        }
      }),
      resources: rawResources.map((r) => ({
        uri: r.uri ?? '',
        name: r.name ?? r.uri ?? '',
        description: r.description ?? '',
        mimeType: r.mimeType ?? '',
      })),
    }
  })
}

export class SocketIOService {
  private socket: Socket | null = null
  private clientId: string

  constructor(
    private config: AppConfig,
    private allTools: ServerToolInfo[],
    private allResources: ServerResourceInfo[],
    private logger: Logger,
    private onFatalDisconnect?: () => void,
  ) {
    this.clientId = getInstallationId()
  }

  private reportUnknownServer(requested: string, sessionId?: string, toolName?: string): void {
    const configured = Object.keys(this.config.servers)
    this.logger.error(`Unknown server: ${requested} (configured: ${configured.join(', ') || 'none'})`)
    reportMcpError(new Error(`Unknown server: ${requested}`), {
      operation: 'unknown_server',
      serverName: requested,
      configuredServers: configured,
      toolName,
      sessionId,
    })
  }

  connect(): void {
    const { deployment_url, auth_token, ssl_verify } = this.config
    const rejectUnauthorized = ssl_verify ?? false

    this.socket = io(deployment_url, {
      extraHeaders: {
        Authorization: `Bearer ${auth_token ?? ''}`,
      },
      rejectUnauthorized,
      reconnection: true,
      reconnectionAttempts: RECONNECTION_ATTEMPTS,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    const socket = this.socket
    const clientId = this.clientId

socket.on('connect', async () => {
      const activeSessions = Object.keys(sessionManager.listSessions())
      const payload = {
        toolkit_configs: buildToolkitConfigs(this.allTools, this.allResources),
        timeout_tools_list: 90,
        timeout_tools_call: 90,
        display_name: this.config.display_name || hostname(),
        active_sessions: activeSessions,
      }
      let isReconnect = false
      try {
        const ack = await socket.timeout(30000).emitWithAck('mcp_connect', payload)
        isReconnect = (ack as { is_reconnect?: boolean })?.is_reconnect === true
      } catch {
        // Fallback for servers that don't ack
        socket.emit('mcp_connect', payload)
      }
      const msg = isReconnect
        ? `Reconnected to Agentic QA connect-gateway (${activeSessions.length} sessions restored)`
        : 'Connected to Agentic QA connect-gateway'
      this.logger.success(msg)
      this.logger.setConnected(true, deployment_url, clientId, payload.display_name, isReconnect)
    })

    socket.on('disconnect', (reason) => {
      this.logger.warning('Disconnected from Agentic QA connect-gateway')
      if (reason === 'io client disconnect') {
        // User clicked Stop/Interrupt — show clean disconnected state
        this.logger.setConnected(false)
      } else {
        // Server went away or network dropped — keep connecting: true so the
        // UI shows the Interrupt button while Socket.IO auto-retries
        this.logger.setConnecting(deployment_url)
      }
      // Intentionally NOT cleaning up sessions — preserved for reconnection
    })

    socket.on('connect_error', (err: Error) => {
      this.logger.error(`Cannot reach ${deployment_url}: ${err.message}`)
      // Keep connecting: true — socket.io will retry automatically
    })

    socket.on('reconnect_failed', () => {
      const msg = `Failed to connect to ${deployment_url} after ${this.socket?.io?.reconnectionAttempts?.() ?? RECONNECTION_ATTEMPTS} attempts`
      this.logger.error(msg)
      this.logger.setConnectionError(msg)
      // Release dead socket to prevent listener leaks
      socket.removeAllListeners()
      this.socket = null
      // Reset ConnectService so the user can click Start again
      this.onFatalDisconnect?.()
    })

    socket.on('mcp_tools_list', async (_data: unknown, callback: (r: unknown) => void) => {
      try {
        const { allTools: refreshedTools, allResources: refreshedResources } = await discoverAll(this.config.servers, this.logger)
        this.allTools = refreshedTools
        this.allResources = refreshedResources
        callback({
          toolkit_configs: buildToolkitConfigs(refreshedTools, refreshedResources),
          timeout_tools_list: 90,
          timeout_tools_call: 90,
        })
      } catch (e) {
        this.logger.error(`Tool list refresh failed: ${e}`)
        callback({ toolkit_configs: [], timeout_tools_list: 90, timeout_tools_call: 90 })
      }
    })

    socket.on(
      'mcp_resources_read',
      async (
        data: { server: string; params: { uri: string }; session_id?: string },
        callback: (r: unknown) => void,
      ) => {
        const { server: requestedName, params, session_id } = data
        const uri = params?.uri
        const resolved = resolveServer(this.config.servers, requestedName)

        if (!resolved) {
          this.reportUnknownServer(requestedName, session_id)
          callback({ error: `Unknown server: ${requestedName}` })
          return
        }
        const [serverName, conf] = resolved

        const readId = this.logger.resourceRead(serverName, uri, session_id)
        try {
          let result: unknown
          if (conf.stateful && session_id) {
            result = await sessionManager.readResourceInSession(session_id, serverName, uri, conf)
          } else {
            result = await sessionManager.readResourceStatelessFallback(conf, uri)
          }
          this.logger.resourceReadOk(serverName, uri, result, session_id, readId)
          callback(result)
        } catch (e) {
          this.logger.resourceReadError(serverName, uri, String(e), session_id, readId)
          reportMcpError(e, { operation: 'resource_read', serverName, conf, sessionId: session_id })
          callback({ error: String(e) })
        }
      },
    )

    socket.on(
      'mcp_tools_call',
      async (
        data: {
          server: string
          params: { name: string; arguments?: Record<string, unknown> }
          session_id?: string
        },
        callback: (r: unknown) => void,
      ) => {
const { server: requestedName, params, session_id } = data
        const resolved = resolveServer(this.config.servers, requestedName)

        if (!resolved) {
          this.reportUnknownServer(requestedName, session_id, params?.name)
          callback({ error: `Unknown server: ${requestedName}` })
          return
        }
        const [serverName, conf] = resolved

        const callId = this.logger.toolCall(serverName, params.name, params.arguments, session_id)
        try {
          let result: import('./mcp-client').SerializedToolResult
          if (conf.stateful && session_id) {
            result = await sessionManager.callToolInSession(
              session_id,
              serverName,
              params.name,
              params.arguments ?? {},
              conf,
            )
          } else if (conf.stateful && !session_id) {
            try {
              result = await sessionManager.callToolInSession(
                '_legacy_',
                serverName,
                params.name,
                params.arguments ?? {},
                conf,
              )
            } catch {
              result = await sessionManager.callToolStatelessFallback(
                conf,
                params.name,
                params.arguments ?? {},
              )
            }
          } else {
            result = await sessionManager.callToolStatelessFallback(
              conf,
              params.name,
              params.arguments ?? {},
            )
          }
          this.logger.toolOk(serverName, params.name, result, session_id, callId)
          const failure = describeToolFailure(result)
          if (failure) {
            reportMcpToolFailure(failure, {
              serverName,
              conf,
              toolName: params.name,
              sessionId: session_id,
              stderrTail: stderrOfResult(result),
            })
          }
          callback(result)
        } catch (e) {
          this.logger.toolError(serverName, params.name, String(e), session_id, callId)
          reportMcpError(e, { operation: 'tool_call', serverName, conf, toolName: params.name, sessionId: session_id })
          callback({ error: String(e) })
        }
      },
    )

    socket.on('mcp_ping', (_data: unknown, callback: (r: unknown) => void) => {
      callback(true)
    })

    socket.on('mcp_notification', (notif: unknown) => {
      this.logger.info(`Notification: ${JSON.stringify(notif)}`)
    })

    socket.on(
      'mcp_session_start',
      async (
        data: { session_id?: string; server_name?: string },
        callback: (r: unknown) => void,
      ) => {
        const { session_id, server_name } = data
        if (!session_id) {
          callback({ success: false, error: 'session_id is required', servers: [] })
          return
        }

        const spawned: string[] = []
        const errors: string[] = []
        const serversConfig = this.config.servers

        const requested = server_name ? resolveServer(serversConfig, server_name) : undefined
        if (server_name && !requested) this.reportUnknownServer(server_name, session_id)

        const targets: Array<[string, ServerConfig]> = server_name
          ? requested
            ? [requested]
            : []
          : Object.entries(serversConfig).filter(([, c]) => c.stateful)

        for (const [name, conf] of targets) {
          try {
            await sessionManager.createSession(session_id, name, conf)
            spawned.push(name)
          } catch (e) {
            errors.push(`${name}: ${e}`)
            reportMcpError(e, { operation: 'session_start', serverName: name, conf, sessionId: session_id })
          }
        }

        if (spawned.length === 0 && errors.length > 0) {
          await sessionManager.destroySession(session_id).catch(() => {})
          callback({
            success: false,
            session_id,
            servers: [],
            error: errors.join('; '),
          })
          return
        }

        this.logger.sessionStart(session_id, spawned)
        callback({
          success: true,
          session_id,
          servers: spawned,
          error: errors.length ? errors.join('; ') : null,
        })
      },
    )

    socket.on(
      'mcp_session_end',
      async (data: { session_id?: string }, callback: (r: unknown) => void) => {
        const { session_id } = data
        if (!session_id) {
          callback({ success: false, error: 'session_id is required' })
          return
        }
        try {
          await sessionManager.destroySession(session_id)
          this.logger.sessionEnd(session_id)
          callback({ success: true, session_id })
        } catch (e) {
          this.logger.error(`Session end failed: ${e}`)
          this.logger.sessionEnd(session_id)
          callback({ success: false, session_id, error: String(e) })
        }
      },
    )
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }
}

async function discoverAll(
  servers: Record<string, ServerConfig>,
  logger?: { info: (msg: string) => void; success: (msg: string) => void; error: (msg: string) => void },
): Promise<{ allTools: ServerToolInfo[]; allResources: ServerResourceInfo[] }> {
  const entries = Object.entries(servers)
  const results = await Promise.allSettled(
    entries.map(([name, conf]) => {
      logger?.info(`Connecting to MCP server "${name}"...`)
      return discoverServer(name, conf)
    }),
  )
  const fulfilled: ServerDiscoveryResult[] = []
  results.forEach((r, i) => {
    const name = entries[i][0]
    if (r.status === 'fulfilled') {
      const { tools, resources } = r.value
      logger?.success(`"${name}": ${tools.length} tool(s), ${resources.length} resource(s)`)
      fulfilled.push(r.value)
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
      logger?.error(`Failed to discover from "${name}": ${reason}`)
      reportMcpError(r.reason, { operation: 'discover', serverName: name, conf: entries[i][1] })
    }
  })
  return {
    allTools: fulfilled.map(({ name, tools }) => ({ name, tools })),
    allResources: fulfilled.map(({ name, resources }) => ({ name, resources })),
  }
}

// Used by mcp_tools_list refresh handler (tools-only reconnect path)
async function discoverAllTools(
  servers: Record<string, ServerConfig>,
): Promise<ServerToolInfo[]> {
  const { allTools } = await discoverAll(servers)
  return allTools
}

export { discoverAll, discoverAllTools }
