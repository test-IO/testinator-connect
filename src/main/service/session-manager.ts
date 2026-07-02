import type { ServerConfig } from '../../shared/ipc-types'
import {
  callToolStateless,
  openPersistentSession,
  serializeToolResult,
  readResourceStateless,
  type LiveSession,
} from './mcp-client'

// session_id → server_name → LiveSession
type SessionMap = Map<string, Map<string, LiveSession>>

class SessionManager {
  private sessions: SessionMap = new Map()

  isStateful(conf: ServerConfig): boolean {
    return conf.stateful === true
  }

  async createSession(
    sessionId: string,
    serverName: string,
    conf: ServerConfig,
  ): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map())
    }
    const serverMap = this.sessions.get(sessionId)!
    if (serverMap.has(serverName)) return

    const session = await openPersistentSession(conf)
    serverMap.set(serverName, session)
  }

  async destroySession(sessionId: string): Promise<void> {
    const serverMap = this.sessions.get(sessionId)
    if (!serverMap) return
    const closeAll = [...serverMap.values()].map((s) => s.close())
    await Promise.allSettled(closeAll)
    this.sessions.delete(sessionId)
  }

  async callToolInSession(
    sessionId: string,
    serverName: string,
    toolName: string,
    arguments_: Record<string, unknown>,
    conf: ServerConfig,
    maxRetries = 2,
  ): Promise<import('./mcp-client').SerializedToolResult> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const session = this.sessions.get(sessionId)?.get(serverName)
        if (!session) throw new Error(`Session ${sessionId}/${serverName} not found`)
        const res = await session.client.callTool({ name: toolName, arguments: arguments_ })
        return serializeToolResult(res as { isError?: boolean; content?: unknown[] })
      } catch (err) {
        if (attempt < maxRetries - 1) {
          await this.destroyServerInSession(sessionId, serverName)
          try {
            await this.createSession(sessionId, serverName, conf)
          } catch {
            // will throw on next attempt
          }
        } else {
          throw err
        }
      }
    }
    throw new Error('unreachable')
  }

  async readResourceInSession(
    sessionId: string,
    serverName: string,
    uri: string,
    conf: ServerConfig,
    maxRetries = 2,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const session = this.sessions.get(sessionId)?.get(serverName)
        if (!session) throw new Error(`Session ${sessionId}/${serverName} not found`)
        const res = await session.client.readResource({ uri })
        return res.contents
      } catch (err) {
        if (attempt < maxRetries - 1) {
          await this.destroyServerInSession(sessionId, serverName)
          try {
            await this.createSession(sessionId, serverName, conf)
          } catch {
            // will throw on next attempt
          }
        } else {
          throw err
        }
      }
    }
    throw new Error('unreachable')
  }

  async readResourceStatelessFallback(conf: ServerConfig, uri: string): Promise<unknown> {
    return readResourceStateless(conf, uri)
  }

  async callToolStatelessFallback(
    conf: ServerConfig,
    toolName: string,
    arguments_: Record<string, unknown>,
  ): Promise<import('./mcp-client').SerializedToolResult> {
    return callToolStateless(conf, toolName, arguments_)
  }

  listSessions(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    for (const [sid, serverMap] of this.sessions) {
      result[sid] = [...serverMap.keys()]
    }
    return result
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  async cleanupAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    await Promise.allSettled(ids.map((id) => this.destroySession(id)))
  }

  private async destroyServerInSession(sessionId: string, serverName: string): Promise<void> {
    const serverMap = this.sessions.get(sessionId)
    if (!serverMap) return
    const session = serverMap.get(serverName)
    if (session) {
      await session.close()
      serverMap.delete(serverName)
    }
  }
}

export const sessionManager = new SessionManager()
