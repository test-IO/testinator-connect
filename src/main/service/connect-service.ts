import type { AppConfig, ToolInfo, ResourceInfo } from '../../shared/ipc-types'
import { discoverAll, SocketIOService } from './socketio-client'
import { sessionManager } from './session-manager'
import type { Logger } from './logger'

export class ConnectService {
  private sioService: SocketIOService | null = null
  private running = false
  private abortController: AbortController | null = null

  constructor(private logger: Logger) {}

  async start(config: AppConfig): Promise<void> {
    if (this.running) return

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    if (!config.ssl_verify) {
      this.logger.warning('SSL verification disabled')
    }

    this.logger.info('Discovering tools and resources from MCP servers...')

    const { allTools, allResources } = await discoverAll(config.servers, this.logger)

    // If stop() was called during discovery, bail out cleanly
    if (signal.aborted) {
      this.logger.warning('Start interrupted before connecting')
      return
    }

    const totalTools = allTools.reduce((n, s) => n + s.tools.length, 0)
    const totalResources = allResources.reduce((n, s) => n + s.resources.length, 0)
    this.logger.success(
      `Found ${totalTools} tools and ${totalResources} resources from ${allTools.length} servers`,
    )

    const toolInfos: ToolInfo[] = allTools.flatMap((s) =>
      s.tools.map((t) => ({
        server: s.name,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    )
    this.logger.setTools(toolInfos)

    const resourceInfos: ResourceInfo[] = allResources.flatMap((s) =>
      s.resources.map((r) => ({
        server: s.name,
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    )
    this.logger.setResources(resourceInfos)

    this.logger.info(`Connecting to ${config.deployment_url}...`)
    this.logger.setConnecting(config.deployment_url)

    this.sioService = new SocketIOService(config, allTools, allResources, this.logger, () => {
      // Reconnection exhausted — reset so the user can click Start again
      this.running = false
      this.sioService = null
    })
    this.sioService.connect()
    this.running = true
  }

  async stop(): Promise<void> {
    // Interrupt an in-progress start() before it reaches the Socket.IO phase
    this.abortController?.abort()
    this.abortController = null

    this.sioService?.disconnect()
    this.sioService = null
    await sessionManager.cleanupAll()
    this.running = false
    // Explicitly clear connecting + error state so the UI resets cleanly
    this.logger.setConnected(false)
    this.logger.warning('Service stopped')
  }

  isRunning(): boolean {
    return this.running
  }
}
