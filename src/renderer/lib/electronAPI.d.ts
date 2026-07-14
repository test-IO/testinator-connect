import type {
  AppConfig,
  LogEntry,
  SessionRecord,
  StatusPayload,
  ToolInfo,
  ToolCallRecord,
  ResourceInfo,
  ResourceReadRecord,
  DeepLinkConfigPayload,
} from '../../shared/ipc-types'

declare global {
  interface Window {
    electronAPI: {
      loadConfig: () => Promise<AppConfig | null>
      saveConfig: (config: AppConfig) => Promise<void>
      startService: () => Promise<void>
      stopService: () => Promise<void>
      testServer: (name: string, conf: ServerConfig) => Promise<{ ok: boolean; toolCount: number; error?: string }>
      onLogEntry: (cb: (entry: LogEntry) => void) => void
      onStatusChanged: (cb: (payload: StatusPayload) => void) => void
      onSessionUpdated: (cb: (record: SessionRecord) => void) => void
      onSessionRemoved: (cb: (payload: { sessionId: string }) => void) => void
      onStatsUpdated: (cb: (payload: Record<string, unknown>) => void) => void
      onToolsUpdated: (cb: (tools: ToolInfo[]) => void) => void
      onToolCallUpdated: (cb: (record: ToolCallRecord) => void) => void
      onResourcesUpdated: (cb: (resources: ResourceInfo[]) => void) => void
      onResourceReadUpdated: (cb: (record: ResourceReadRecord) => void) => void
      resetSession: () => Promise<void>
      openConfigFile: () => Promise<void>
      checkPlaywrightBrowser: (browser: string) => Promise<boolean>
      installPlaywrightBrowser: (browser: string, sudoPassword?: string) => Promise<void>
      onPlaywrightInstallProgress: (cb: (line: string) => void) => void
      onDeepLinkConfig: (cb: (payload: DeepLinkConfigPayload) => void) => void
    }
  }
}
