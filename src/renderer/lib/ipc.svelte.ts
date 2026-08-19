import type {
  LogEntry,
  SessionRecord,
  StatusPayload,
  ToolInfo,
  ToolCallRecord,
  ResourceInfo,
  ResourceReadRecord,
} from '../../shared/ipc-types'

export const logs: LogEntry[] = $state([])
export const status: StatusPayload = $state({ connected: false })
export const sessions: Map<string, SessionRecord> = $state(new Map())
export const stats = $state({ activeSessions: 0, totalCalls: 0 })
export const serviceError: { message: string | null } = $state({ message: null })
export const tools: ToolInfo[] = $state([])
export const toolCalls: ToolCallRecord[] = $state([])
export const resources: ResourceInfo[] = $state([])
export const resourceReads: ResourceReadRecord[] = $state([])
export const deepLinkPrefill: { deploymentUrl: string | null; authToken: string | null } =
  $state({ deploymentUrl: null, authToken: null })
export const appVersion: { value: string } = $state({ value: '' })

// Set once a deep link has triggered (or confirmed) a connect, so the app
// shell can jump to the Dashboard tab and show a one-time confirmation
// banner pointing the user at Testinator Workflow's Agentic QA Connect
// settings — that's how they confirm the install actually worked.
export const postConnectNavigate: { requested: boolean } = $state({ requested: false })
export const showConnectConfirmation: { active: boolean } = $state({ active: false })

export function initIpc(): void {
  // Surface the Client ID immediately so it's visible before the first
  // connection — you need it to generate a handshake token in workflow.
  void window.electronAPI.getInstallationId().then((id) => {
    if (id) status.installationId = id
  })

  window.electronAPI.getAppVersion().then((version) => {
    appVersion.value = version
  })

  window.electronAPI.onLogEntry((entry) => {
    logs.push(entry)
    if (logs.length > 2000) logs.splice(0, logs.length - 2000)
  })

  window.electronAPI.onStatusChanged((payload) => {
    status.connected = payload.connected
    if (payload.connecting !== undefined) status.connecting = payload.connecting
    if (payload.deploymentUrl !== undefined) status.deploymentUrl = payload.deploymentUrl
    if (payload.installationId !== undefined) status.installationId = payload.installationId
    if (payload.displayName !== undefined) status.displayName = payload.displayName
    if (payload.isReconnect !== undefined) status.isReconnect = payload.isReconnect
    if (payload.connectionError !== undefined) serviceError.message = payload.connectionError ?? null
  })

  window.electronAPI.onSessionUpdated((record) => {
    sessions.set(record.sessionId, record)
    stats.activeSessions = [...sessions.values()].filter((s) => s.status === 'active').length
  })

  window.electronAPI.onSessionRemoved(({ sessionId }) => {
    const existing = sessions.get(sessionId)
    if (existing) {
      sessions.set(sessionId, { ...existing, status: 'ended' })
    }
    stats.activeSessions = [...sessions.values()].filter((s) => s.status === 'active').length
  })

  window.electronAPI.onStatsUpdated((payload) => {
    if ('totalCalls' in payload && typeof payload.totalCalls === 'number') {
      stats.totalCalls = payload.totalCalls
    }
  })

  window.electronAPI.onToolsUpdated((newTools) => {
    tools.splice(0, tools.length, ...newTools)
  })

  window.electronAPI.onToolCallUpdated((record) => {
    const idx = toolCalls.findIndex((c) => c.id === record.id)
    if (idx >= 0) {
      toolCalls[idx] = record
    } else {
      toolCalls.unshift(record)
      if (toolCalls.length > 500) toolCalls.splice(500)
    }
  })

  window.electronAPI.onResourcesUpdated((newResources) => {
    resources.splice(0, resources.length, ...newResources)
  })

  window.electronAPI.onResourceReadUpdated((record) => {
    const idx = resourceReads.findIndex((r) => r.id === record.id)
    if (idx >= 0) {
      resourceReads[idx] = record
    } else {
      resourceReads.unshift(record)
      if (resourceReads.length > 500) resourceReads.splice(500)
    }
  })

  window.electronAPI.onDeepLinkConfig((payload) => {
    deepLinkPrefill.deploymentUrl = payload.deploymentUrl
    if (payload.authToken) deepLinkPrefill.authToken = payload.authToken
  })
}

export async function resetSession(): Promise<void> {
  await window.electronAPI.resetSession()
  logs.splice(0, logs.length)
  toolCalls.splice(0, toolCalls.length)
  tools.splice(0, tools.length)
  resources.splice(0, resources.length)
  resourceReads.splice(0, resourceReads.length)
  sessions.clear()
  stats.activeSessions = 0
  stats.totalCalls = 0
}
