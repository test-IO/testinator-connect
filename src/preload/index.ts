import { contextBridge, ipcRenderer } from 'electron'
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
} from '../shared/ipc-types'
import { IPC_TO_MAIN, IPC_TO_RENDERER } from '../shared/ipc-types'

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer → Main
  loadConfig: (): Promise<AppConfig | null> => ipcRenderer.invoke(IPC_TO_MAIN.CONFIG_LOAD),
  saveConfig: (config: AppConfig): Promise<void> =>
    ipcRenderer.invoke(IPC_TO_MAIN.CONFIG_SAVE, config),
  startService: (): Promise<void> => ipcRenderer.invoke(IPC_TO_MAIN.SERVICE_START),
  stopService: (): Promise<void> => ipcRenderer.invoke(IPC_TO_MAIN.SERVICE_STOP),
  testServer: (name: string, conf: ServerConfig): Promise<{ ok: boolean; toolCount: number; error?: string }> =>
    ipcRenderer.invoke(IPC_TO_MAIN.SERVER_TEST, name, conf),

  // Main → Renderer: event subscriptions
  onLogEntry: (cb: (entry: LogEntry) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.LOG_ENTRY, (_e, payload) => cb(payload))
  },
  onStatusChanged: (cb: (payload: StatusPayload) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.STATUS_CHANGED, (_e, payload) => cb(payload))
  },
  onSessionUpdated: (cb: (record: SessionRecord) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.SESSION_UPDATED, (_e, payload) => cb(payload))
  },
  onSessionRemoved: (cb: (payload: { sessionId: string }) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.SESSION_REMOVED, (_e, payload) => cb(payload))
  },
  onStatsUpdated: (cb: (payload: { type: string }) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.STATS_UPDATED, (_e, payload) => cb(payload))
  },
  onToolsUpdated: (cb: (tools: ToolInfo[]) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.TOOLS_UPDATED, (_e, payload) => cb(payload))
  },
  onToolCallUpdated: (cb: (record: ToolCallRecord) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.TOOL_CALL_UPDATED, (_e, payload) => cb(payload))
  },
  onResourcesUpdated: (cb: (resources: ResourceInfo[]) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.RESOURCES_UPDATED, (_e, payload) => cb(payload))
  },
  onResourceReadUpdated: (cb: (record: ResourceReadRecord) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.RESOURCE_READ_UPDATED, (_e, payload) => cb(payload))
  },
  resetSession: (): Promise<void> => ipcRenderer.invoke(IPC_TO_MAIN.SESSION_RESET),
  openConfigFile: (): Promise<void> => ipcRenderer.invoke(IPC_TO_MAIN.CONFIG_OPEN_FILE),
  checkPlaywrightBrowser: (browser: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_TO_MAIN.PLAYWRIGHT_CHECK, browser),
  installPlaywrightBrowser: (browser: string, sudoPassword?: string): Promise<void> =>
    ipcRenderer.invoke(IPC_TO_MAIN.PLAYWRIGHT_INSTALL, browser, sudoPassword),
  onPlaywrightInstallProgress: (cb: (line: string) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.PLAYWRIGHT_INSTALL_PROGRESS, (_e, line) => cb(line))
  },
  onDeepLinkConfig: (cb: (payload: DeepLinkConfigPayload) => void): void => {
    ipcRenderer.on(IPC_TO_RENDERER.DEEP_LINK_CONFIG, (_e, payload) => cb(payload))
  },
})
