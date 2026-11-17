import type { SerializedToolResult } from './service/mcp-client'

// How a tool call that reached the server but did not do its job looks like on the wire.
//  - 'is_error': the MCP result carries isError (e.g. windows-mcp's CONTROL_PREEMPTED).
//  - 'error_text': the server answered with plain text such as "Error capturing desktop
//    state: ..." without setting isError, so only the wording gives it away.
export interface ToolFailure {
  kind: 'is_error' | 'error_text'
  // Machine-readable code when the server sends a JSON body like {"code": "CONTROL_PREEMPTED"}.
  code?: string
  // Short, stable one-liner used for the error message (and so for Airbrake grouping).
  summary: string
  text: string
  // Structured `status` from the JSON body, kept as-is (windows-mcp reports its control state here).
  status?: unknown
}

const MAX_TEXT_CHARS = 1500
const MAX_SUMMARY_CHARS = 120
const MAX_STATUS_CHARS = 500
const ERROR_TEXT = /^\s*(Error|Failed)\b/

function textOf(result: SerializedToolResult): string {
  return result.content
    .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
}

function parseJsonBody(text: string): { code?: string; status?: unknown; message?: string } {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return {}
  try {
    const body = JSON.parse(trimmed) as Record<string, unknown>
    const status = body.status
    return {
      code: typeof body.code === 'string' ? body.code : undefined,
      status: status !== undefined && JSON.stringify(status).length <= MAX_STATUS_CHARS ? status : undefined,
      message: [body.message, body.error].find((m): m is string => typeof m === 'string'),
    }
  } catch {
    return {}
  }
}

export function describeToolFailure(result: SerializedToolResult): ToolFailure | null {
  const text = textOf(result)
  const isError = result.isError
  // A plain-text "Error ..." next to an image is a screenshot with a caption, not a failure.
  const hasImage = result.content.some((block) => block.type === 'image')
  if (!isError && (hasImage || !ERROR_TEXT.test(text))) return null

  const body = parseJsonBody(text)
  const firstLine = (body.message ?? text).split('\n').find((line) => line.trim())?.trim() ?? 'no message'
  return {
    kind: isError ? 'is_error' : 'error_text',
    code: body.code,
    summary: (body.code ?? firstLine).slice(0, MAX_SUMMARY_CHARS),
    text: text.slice(0, MAX_TEXT_CHARS),
    status: body.status,
  }
}

export class McpToolFailureError extends Error {
  constructor(serverName: string, toolName: string, failure: ToolFailure) {
    super(`${serverName}.${toolName} failed: ${failure.summary}`)
    this.name = 'McpToolFailureError'
  }
}

// A QA run can hit the same failing tool dozens of times. Report each distinct failure once
// per window and cap the total, so Airbrake gets the signal without a flood.
const REPEAT_WINDOW_MS = 60 * 60 * 1000
const MAX_REPORTS_PER_WINDOW = 20

export class FailureThrottle {
  private lastSeen = new Map<string, number>()
  private windowStart = 0
  private reportedInWindow = 0

  shouldReport(key: string, now = Date.now()): boolean {
    if (now - this.windowStart >= REPEAT_WINDOW_MS) {
      this.windowStart = now
      this.reportedInWindow = 0
      this.lastSeen.clear()
    }
    if (this.lastSeen.has(key) || this.reportedInWindow >= MAX_REPORTS_PER_WINDOW) return false
    this.lastSeen.set(key, now)
    this.reportedInWindow++
    return true
  }
}

const STDERR_LINES = 15
const STDERR_CHARS = 2000

// Last lines of a server's stderr without colour codes, newest last.
export function cleanStderrLines(raw: string, maxLines: number): string[] {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
}

export function stderrForReport(raw: string): string | undefined {
  const lines = cleanStderrLines(raw, STDERR_LINES).join('\n')
  return lines ? lines.slice(-STDERR_CHARS) : undefined
}
