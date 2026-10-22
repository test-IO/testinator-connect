import { describe, expect, it } from 'vitest'
import { DOWNLOADS, detectOs } from '../../docs/assets/js/download.js'

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

describe('detectOs', () => {
  it('windows', () => expect(detectOs({ userAgent: WIN, platform: 'Win32' })).toBe('windows'))
  it('mac', () => expect(detectOs({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac'))
  it('iPadOS reporting Macintosh is other', () =>
    expect(detectOs({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('other'))
  it('iPhone is other', () => expect(detectOs({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 })).toBe('other'))
  it('Android is other', () => expect(detectOs({ userAgent: ANDROID, platform: 'Linux armv8l' })).toBe('other'))
  it('Linux is other', () => expect(detectOs({ userAgent: LINUX, platform: 'Linux x86_64' })).toBe('other'))
})

describe('DOWNLOADS', () => {
  it('links to the stable installer names of the latest release', () =>
    expect(DOWNLOADS).toEqual({
      windows: 'https://github.com/test-IO/testinator-connect/releases/latest/download/Agentic-QA-Connect-Setup-win-x64.exe',
      macArm: 'https://github.com/test-IO/testinator-connect/releases/latest/download/Agentic-QA-Connect-mac-arm64.dmg',
      macIntel: 'https://github.com/test-IO/testinator-connect/releases/latest/download/Agentic-QA-Connect-mac-x64.dmg',
    }))
})
