import { describe, expect, it } from 'vitest'
import {
  cleanStderrLines,
  describeToolFailure,
  FailureThrottle,
  McpToolFailureError,
  stderrForReport,
} from '../../src/main/mcp-tool-failure'
import type { SerializedToolResult } from '../../src/main/service/mcp-client'

const text = (t: string, isError = false): SerializedToolResult => ({ isError, content: [{ type: 'text', text: t }] })

describe('describeToolFailure', () => {
  it('reads the code and control status from an isError JSON body', () => {
    const body = JSON.stringify({ code: 'CONTROL_PREEMPTED', status: { state: 'unavailable' } })
    expect(describeToolFailure(text(body, true))).toMatchObject({
      kind: 'is_error',
      code: 'CONTROL_PREEMPTED',
      summary: 'CONTROL_PREEMPTED',
      status: { state: 'unavailable' },
    })
  })

  it('reports a plain-text isError result by its first line', () => {
    expect(describeToolFailure(text('Element not found\nselector: #x', true))).toMatchObject({
      kind: 'is_error',
      summary: 'Element not found',
    })
  })

  it('catches an error sent as plain text without isError', () => {
    expect(describeToolFailure(text('Error capturing desktop state: boom'))).toMatchObject({
      kind: 'error_text',
      summary: 'Error capturing desktop state: boom',
    })
  })

  it('ignores successful results, including text that only mentions an error', () => {
    expect(describeToolFailure(text('Page title: Errors and warnings'))).toBeNull()
    expect(describeToolFailure({ isError: false, content: [] })).toBeNull()
  })

  it('does not treat an image with an error-like caption as a failure', () => {
    const result: SerializedToolResult = {
      isError: false,
      content: [{ type: 'text', text: 'Error list screenshot' }, { type: 'image', data: 'abc', mimeType: 'image/png' }],
    }
    expect(describeToolFailure(result)).toBeNull()
  })

  it('bounds the text and the summary', () => {
    const failure = describeToolFailure(text('x'.repeat(5000), true))!
    expect(failure.text).toHaveLength(1500)
    expect(failure.summary).toHaveLength(120)
  })

  it('drops an oversized status', () => {
    const body = JSON.stringify({ code: 'X', status: { blob: 'y'.repeat(1000) } })
    expect(describeToolFailure(text(body, true))!.status).toBeUndefined()
  })
})

describe('McpToolFailureError', () => {
  it('names the server, the tool and the failure so Airbrake groups by them', () => {
    const failure = describeToolFailure(text('{"code":"CONTROL_PREEMPTED"}', true))!
    const error = new McpToolFailureError('windows_mcp', 'Click', failure)
    expect(error.name).toBe('McpToolFailureError')
    expect(error.message).toBe('windows_mcp.Click failed: CONTROL_PREEMPTED')
  })
})

describe('FailureThrottle', () => {
  it('reports a repeated failure once per window', () => {
    const throttle = new FailureThrottle()
    expect(throttle.shouldReport('a', 0)).toBe(true)
    expect(throttle.shouldReport('a', 1000)).toBe(false)
    expect(throttle.shouldReport('b', 1000)).toBe(true)
    expect(throttle.shouldReport('a', 60 * 60 * 1000 + 1)).toBe(true)
  })

  it('caps the number of reports in a window', () => {
    const throttle = new FailureThrottle()
    const sent = Array.from({ length: 30 }, (_, i) => throttle.shouldReport(`k${i}`, 0)).filter(Boolean)
    expect(sent).toHaveLength(20)
  })
})

describe('stderr helpers', () => {
  it('strips colour codes and keeps the newest lines', () => {
    expect(cleanStderrLines('\x1b[31mone\x1b[0m\n\ntwo\nthree\n', 2)).toEqual(['two', 'three'])
  })

  it('returns nothing for an empty stderr', () => {
    expect(stderrForReport('  \n')).toBeUndefined()
  })

  it('keeps the end of a long stderr', () => {
    const report = stderrForReport('a'.repeat(5000) + '\nlast line')!
    expect(report).toHaveLength(2000)
    expect(report.endsWith('last line')).toBe(true)
  })
})
