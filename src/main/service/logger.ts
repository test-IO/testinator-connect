import type { BrowserWindow } from 'electron'
import type {
  LogEntry,
  SessionRecord,
  ToolInfo,
  ToolCallRecord,
  ResourceInfo,
  ResourceReadRecord,
} from '../../shared/ipc-types'
import { IPC_TO_RENDERER } from '../../shared/ipc-types'

export class Logger {
  private totalCalls = 0
  private callCounter = 0
  private resourceCallCounter = 0
  private logSeq = 0
  private pendingCalls = new Map<string, { startMs: number; record: ToolCallRecord }>()
  private pendingResourceReads = new Map<string, { startMs: number; record: ResourceReadRecord }>()

  constructor(private getWindow: () => BrowserWindow | null) {}

  private send(channel: string, payload: unknown): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  private log(level: LogEntry['level'], message: string, sessionId?: string): void {
    const entry: LogEntry = {
      seq: ++this.logSeq,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      level,
      message,
      sessionId,
    }
    this.send(IPC_TO_RENDERER.LOG_ENTRY, entry)
  }

  info(msg: string): void { this.log('info', msg) }
  success(msg: string): void { this.log('success', msg) }
  warning(msg: string): void { this.log('warning', msg) }
  error(msg: string): void { this.log('error', msg) }

  toolCall(server: string, tool: string, args?: Record<string, unknown>, sessionId?: string): string {
    const id = `${Date.now()}-${++this.callCounter}`
    const record: ToolCallRecord = {
      id,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      server,
      tool,
      sessionId,
      args,
      status: 'pending',
    }
    this.pendingCalls.set(id, { startMs: Date.now(), record })
    this.send(IPC_TO_RENDERER.TOOL_CALL_UPDATED, record)
    this.log('tool_call', `${server}.${tool}`, sessionId)
    this.totalCalls++
    this.send(IPC_TO_RENDERER.STATS_UPDATED, { totalCalls: this.totalCalls })
    return id
  }

  toolOk(server: string, tool: string, result: unknown, sessionId?: string, callId?: string): void {
    let preview: string
    if (typeof result === 'string') {
      preview = result.length > 120 ? result.slice(0, 120) + '...' : result
    } else if (Array.isArray(result)) {
      preview = `[${result.length} items]`
    } else if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).content)) {
      const blocks = (result as { content: Array<{ type: string; text?: string; data?: string }> }).content
      const parts = blocks.map((b) => {
        if (b.type === 'text') return b.text?.slice(0, 80) ?? ''
        if (b.type === 'image') return `[image${b.mimeType ? ' ' + b.mimeType : ''}]`
        return `[${b.type}]`
      })
      preview = parts.join(' ').slice(0, 120)
    } else {
      preview = JSON.stringify(result)?.slice(0, 120) ?? String(result)
    }
    this.log('tool_ok', `${server}.${tool} → ${preview}`, sessionId)
    if (callId) {
      const pending = this.pendingCalls.get(callId)
      if (pending) {
        const updated: ToolCallRecord = {
          ...pending.record,
          result,
          status: 'ok',
          durationMs: Date.now() - pending.startMs,
        }
        this.pendingCalls.delete(callId)
        this.send(IPC_TO_RENDERER.TOOL_CALL_UPDATED, updated)
      }
    }
  }

  toolError(server: string, tool: string, error: string, sessionId?: string, callId?: string): void {
    this.log('tool_error', `${server}.${tool} → ${error}`, sessionId)
    if (callId) {
      const pending = this.pendingCalls.get(callId)
      if (pending) {
        const updated: ToolCallRecord = {
          ...pending.record,
          error,
          status: 'error',
          durationMs: Date.now() - pending.startMs,
        }
        this.pendingCalls.delete(callId)
        this.send(IPC_TO_RENDERER.TOOL_CALL_UPDATED, updated)
      }
    }
  }

  sessionStart(sessionId: string, servers: string[]): void {
    this.log('session', `Session ${sessionId.slice(0, 8)}... started with [${servers.join(', ')}]`)
    const record: SessionRecord = { sessionId, servers, status: 'active', callCount: 0 }
    this.send(IPC_TO_RENDERER.SESSION_UPDATED, record)
  }

  sessionEnd(sessionId: string): void {
    this.log('session', `Session ${sessionId.slice(0, 8)}... ended`)
    this.send(IPC_TO_RENDERER.SESSION_REMOVED, { sessionId })
  }

  setConnecting(deploymentUrl: string): void {
    this.send(IPC_TO_RENDERER.STATUS_CHANGED, {
      connected: false,
      connecting: true,
      deploymentUrl,
      connectionError: null,
    })
  }

  setConnected(connected: boolean, deploymentUrl?: string, installationId?: string, displayName?: string, isReconnect?: boolean): void {
    this.send(IPC_TO_RENDERER.STATUS_CHANGED, {
      connected,
      connecting: false,
      deploymentUrl,
      installationId,
      displayName,
      isReconnect,
      connectionError: null,
    })
  }

  setConnectionError(message: string): void {
    this.send(IPC_TO_RENDERER.STATUS_CHANGED, {
      connected: false,
      connecting: false,
      connectionError: message,
    })
  }

  setTools(tools: ToolInfo[]): void {
    this.send(IPC_TO_RENDERER.TOOLS_UPDATED, tools)
  }

  setResources(resources: ResourceInfo[]): void {
    this.send(IPC_TO_RENDERER.RESOURCES_UPDATED, resources)
  }

  resourceRead(server: string, uri: string, sessionId?: string): string {
    const id = `r-${Date.now()}-${++this.resourceCallCounter}`
    const record: ResourceReadRecord = {
      id,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      server,
      uri,
      sessionId,
      status: 'pending',
    }
    this.pendingResourceReads.set(id, { startMs: Date.now(), record })
    this.send(IPC_TO_RENDERER.RESOURCE_READ_UPDATED, record)
    this.log('resource_read', `${server} → ${uri}`, sessionId)
    return id
  }

  resourceReadOk(server: string, uri: string, result: unknown, sessionId?: string, readId?: string): void {
    this.log('resource_ok', `${server} → ${uri}`, sessionId)
    if (readId) {
      const pending = this.pendingResourceReads.get(readId)
      if (pending) {
        const updated: ResourceReadRecord = {
          ...pending.record,
          result,
          status: 'ok',
          durationMs: Date.now() - pending.startMs,
        }
        this.pendingResourceReads.delete(readId)
        this.send(IPC_TO_RENDERER.RESOURCE_READ_UPDATED, updated)
      }
    }
  }

  resourceReadError(server: string, uri: string, error: string, sessionId?: string, readId?: string): void {
    this.log('resource_error', `${server} → ${uri} error: ${error}`, sessionId)
    if (readId) {
      const pending = this.pendingResourceReads.get(readId)
      if (pending) {
        const updated: ResourceReadRecord = {
          ...pending.record,
          error,
          status: 'error',
          durationMs: Date.now() - pending.startMs,
        }
        this.pendingResourceReads.delete(readId)
        this.send(IPC_TO_RENDERER.RESOURCE_READ_UPDATED, updated)
      }
    }
  }

  reset(): void {
    this.totalCalls = 0
    this.pendingCalls.clear()
    this.pendingResourceReads.clear()
    this.send(IPC_TO_RENDERER.STATS_UPDATED, { totalCalls: 0 })
    this.send(IPC_TO_RENDERER.TOOLS_UPDATED, [])
    this.send(IPC_TO_RENDERER.RESOURCES_UPDATED, [])
  }
}
