import { describe, expect, it } from 'vitest'
import { isUpdateIncoming, updateLabel } from '../../src/shared/update-label'

describe('updateLabel', () => {
  it('shows nothing before the first check', () => {
    expect(updateLabel({ status: 'idle' })).toBe('')
  })

  it('tells unsigned macOS users that updates are manual, without alarming them', () => {
    expect(updateLabel({ status: 'disabled' })).toBe('Manual updates only')
  })

  it('shows the version and progress while downloading', () => {
    expect(updateLabel({ status: 'downloading', version: '0.2.0', percent: 42 })).toBe('Downloading 0.2.0 · 42%')
  })

  it('falls back to 0% when progress has not arrived yet', () => {
    expect(updateLabel({ status: 'downloading', version: '0.2.0' })).toBe('Downloading 0.2.0 · 0%')
  })

  it('names the version that is ready', () => {
    expect(updateLabel({ status: 'downloaded', version: '0.2.0' })).toBe('Version 0.2.0 is ready')
  })

  it('keeps a failed check short', () => {
    expect(updateLabel({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' })).toBe('Update check failed')
  })

  it('covers checking and up-to-date', () => {
    expect(updateLabel({ status: 'checking' })).toBe('Checking for updates…')
    expect(updateLabel({ status: 'up-to-date' })).toBe('Up to date')
  })
})

describe('isUpdateIncoming', () => {
  it('is true only while an update downloads or waits for a restart', () => {
    expect(isUpdateIncoming({ status: 'downloading', version: '0.2.0' })).toBe(true)
    expect(isUpdateIncoming({ status: 'downloaded', version: '0.2.0' })).toBe(true)
    for (const status of ['idle', 'disabled', 'checking', 'up-to-date', 'error'] as const) {
      expect(isUpdateIncoming({ status })).toBe(false)
    }
  })
})
