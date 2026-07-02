export const IPC_TO_MAIN = {
  CONFIG_LOAD: 'config:load',
  CONFIG_SAVE: 'config:save',
  SERVICE_START: 'service:start',
  SERVICE_STOP: 'service:stop',
  SERVER_TEST: 'server:test',
  SESSION_RESET: 'session:reset',
  PLAYWRIGHT_INSTALL: 'playwright:install',
  PLAYWRIGHT_CHECK: 'playwright:check',
  CONFIG_OPEN_FILE: 'config:open-file',
} as const

export const IPC_TO_RENDERER = {
  LOG_ENTRY: 'log:entry',
  STATUS_CHANGED: 'status:changed',
  SESSION_UPDATED: 'session:updated',
  SESSION_REMOVED: 'session:removed',
  STATS_UPDATED: 'stats:updated',
  TOOLS_UPDATED: 'tools:updated',
  TOOL_CALL_UPDATED: 'tool-call:updated',
  RESOURCES_UPDATED: 'resources:updated',
  RESOURCE_READ_UPDATED: 'resource-read:updated',
  PLAYWRIGHT_INSTALL_PROGRESS: 'playwright:install-progress',
} as const

export type LogLevel =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'tool_call'
  | 'tool_ok'
  | 'tool_error'
  | 'session'
  | 'resource_read'
  | 'resource_ok'
  | 'resource_error'

export interface LogEntry {
  seq: number
  timestamp: string
  level: LogLevel
  message: string
  sessionId?: string
}

export interface SessionRecord {
  sessionId: string
  servers: string[]
  status: 'active' | 'ended'
  callCount: number
}

export interface StatusPayload {
  connected: boolean
  connecting?: boolean      // Socket.IO is actively trying to reach the server
  deploymentUrl?: string
  installationId?: string   // Persistent 16-char hex ID shown in the UI
  displayName?: string
  isReconnect?: boolean
  connectionError?: string | null  // Last error message from connect_error / reconnect_failed
}

export interface StatsPayload {
  activeSessions?: number
  totalCalls?: number
}

export interface ToolInfo {
  server: string
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

export interface ResourceInfo {
  server: string
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface ResourceReadRecord {
  id: string
  timestamp: string
  server: string
  uri: string
  sessionId?: string
  result?: unknown
  error?: string
  status: 'pending' | 'ok' | 'error'
  durationMs?: number
}

export interface ToolCallRecord {
  id: string
  timestamp: string
  server: string
  tool: string
  sessionId?: string
  args?: Record<string, unknown>
  result?: unknown
  error?: string
  status: 'pending' | 'ok' | 'error'
  durationMs?: number
}

export interface ServerConfig {
  type?: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  stateful?: boolean
}

export interface AppConfig {
  deployment_url: string
  auth_token?: string
  timeout?: number
  ssl_verify?: boolean
  display_name?: string
  servers: Record<string, ServerConfig>
}
