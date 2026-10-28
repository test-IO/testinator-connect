import { describe, expect, it } from 'vitest'
import { INITIAL_UPDATE_STATE, reduceUpdateState } from '../../../src/main/updater/update-state'
import type { UpdateState } from '../../../src/shared/ipc-types'

describe('reduceUpdateState', () => {
  it('starts idle', () => {
    expect(INITIAL_UPDATE_STATE).toEqual({ status: 'idle' })
  })

  it('moves to downloading at 0% when an update is available', () => {
    const next = reduceUpdateState({ status: 'checking' }, { type: 'available', version: '0.2.0' })
    expect(next).toEqual({ status: 'downloading', version: '0.2.0', percent: 0 })
  })

  it('rounds and clamps download progress, keeping the version', () => {
    const downloading: UpdateState = { status: 'downloading', version: '0.2.0', percent: 0 }
    expect(reduceUpdateState(downloading, { type: 'progress', percent: 41.6 })).toEqual({
      status: 'downloading',
      version: '0.2.0',
      percent: 42,
    })
    expect(reduceUpdateState(downloading, { type: 'progress', percent: 130 }).percent).toBe(100)
    expect(reduceUpdateState(downloading, { type: 'progress', percent: -5 }).percent).toBe(0)
  })

  it('reports up-to-date when nothing newer exists', () => {
    expect(reduceUpdateState({ status: 'checking' }, { type: 'not-available' })).toEqual({ status: 'up-to-date' })
  })

  it('keeps a downloaded update ready when a later background check fails', () => {
    const ready: UpdateState = { status: 'downloaded', version: '0.2.0' }
    expect(reduceUpdateState(ready, { type: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' })).toBe(ready)
    expect(reduceUpdateState(ready, { type: 'checking' })).toBe(ready)
    expect(reduceUpdateState(ready, { type: 'not-available' })).toBe(ready)
  })

  it('replaces a downloaded update with a newer downloaded one', () => {
    const ready: UpdateState = { status: 'downloaded', version: '0.2.0' }
    expect(reduceUpdateState(ready, { type: 'downloaded', version: '0.3.0' })).toEqual({
      status: 'downloaded',
      version: '0.3.0',
    })
  })

  it('keeps only the first line of an error, capped at 160 characters', () => {
    const long = `${'x'.repeat(200)}\n    at stack frame`
    const next = reduceUpdateState({ status: 'checking' }, { type: 'error', message: long })
    expect(next.status).toBe('error')
    expect(next.message).toHaveLength(160)
    expect(next.message?.endsWith('...')).toBe(true)
    expect(next.message).not.toContain('stack frame')
  })
})
