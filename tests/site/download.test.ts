import { describe, expect, it } from 'vitest'
import { detectOs, pickAssets } from '../../docs/download.js'

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

const a = (name: string) => ({ name, browser_download_url: `https://x/${name}` })

describe('pickAssets', () => {
  it('new naming scheme', () => {
    const r = pickAssets([
      a('Agentic-QA-Connect-mac-arm64.dmg'), a('Agentic-QA-Connect-mac-x64.dmg'),
      a('Agentic-QA-Connect-mac-arm64.zip'), a('Agentic-QA-Connect-Setup-win-x64.exe'),
      a('Agentic-QA-Connect-Setup-win-x64.exe.blockmap'), a('latest.yml'),
    ])
    expect(r).toEqual({
      windows: 'https://x/Agentic-QA-Connect-Setup-win-x64.exe',
      macArm: 'https://x/Agentic-QA-Connect-mac-arm64.dmg',
      macIntel: 'https://x/Agentic-QA-Connect-mac-x64.dmg',
    })
  })
  it('old naming scheme (arch-less dmg is Intel)', () => {
    const r = pickAssets([
      a('Agentic-QA---connect-0.0.1-abc-arm64.dmg'), a('Agentic-QA---connect-0.0.1-abc.dmg'),
      a('Agentic-QA---connect-Setup-0.0.1-abc.exe'), a('Agentic-QA---connect-0.0.1-abc.dmg.blockmap'),
    ])
    expect(r.windows).toBe('https://x/Agentic-QA---connect-Setup-0.0.1-abc.exe')
    expect(r.macArm).toBe('https://x/Agentic-QA---connect-0.0.1-abc-arm64.dmg')
    expect(r.macIntel).toBe('https://x/Agentic-QA---connect-0.0.1-abc.dmg')
  })
  it('missing assets give null', () => {
    expect(pickAssets([])).toEqual({ windows: null, macArm: null, macIntel: null })
    expect(pickAssets(undefined)).toEqual({ windows: null, macArm: null, macIntel: null })
  })
  it('ignores zip, blockmap, yml', () => {
    expect(pickAssets([a('x.zip'), a('x.exe.blockmap'), a('x.dmg.blockmap'), a('latest-mac.yml')]))
      .toEqual({ windows: null, macArm: null, macIntel: null })
  })
})
