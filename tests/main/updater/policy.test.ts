import { describe, expect, it } from 'vitest'
import { CHECK_INTERVAL_MS, canInstallNow, isUpdaterEnabled, upToDateMessage } from '../../../src/main/updater/policy'

describe('isUpdaterEnabled', () => {
  const packagedWindows = { isPackaged: true, platform: 'win32' as const, macSigned: false, autoUpdateEnabled: true }

  it('is off in development builds', () => {
    expect(isUpdaterEnabled({ ...packagedWindows, isPackaged: false })).toBe(false)
  })

  it('is on for packaged Windows builds, signed or not', () => {
    expect(isUpdaterEnabled(packagedWindows)).toBe(true)
  })

  it('is on for packaged macOS builds only when signed with a Developer ID', () => {
    expect(isUpdaterEnabled({ ...packagedWindows, platform: 'darwin', macSigned: false })).toBe(false)
    expect(isUpdaterEnabled({ ...packagedWindows, platform: 'darwin', macSigned: true })).toBe(true)
  })

  it('is off on platforms we do not ship', () => {
    expect(isUpdaterEnabled({ ...packagedWindows, platform: 'linux', macSigned: true })).toBe(false)
  })

  it('is off in an emergency build with auto-update disabled, on every platform', () => {
    expect(isUpdaterEnabled({ ...packagedWindows, autoUpdateEnabled: false })).toBe(false)
    expect(isUpdaterEnabled({ ...packagedWindows, platform: 'darwin', macSigned: true, autoUpdateEnabled: false })).toBe(false)
  })
})

describe('canInstallNow', () => {
  it('allows installing when no session is running', () => {
    expect(canInstallNow(0)).toEqual({ ok: true })
  })

  it('refuses while one session is running and says why', () => {
    const decision = canInstallNow(1)
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.reason).toContain('1 test session is running')
      expect(decision.reason).toContain('when you quit')
    }
  })

  it('pluralises for several sessions', () => {
    const decision = canInstallNow(3)
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toContain('3 test sessions are running')
  })
})

describe('CHECK_INTERVAL_MS', () => {
  it('re-checks every four hours', () => {
    expect(CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000)
  })
})

describe('upToDateMessage', () => {
  it('names the installed version, like the indicator label', () => {
    expect(upToDateMessage('0.1.0')).toBe('Up to date (0.1.0)')
  })
})
