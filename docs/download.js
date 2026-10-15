// Points the landing-page download buttons at the latest release assets.
// Any failure leaves the static hrefs (release page) untouched.
const API = 'https://api.github.com/repos/test-IO/testinator-connect/releases/latest'

/** @param {{userAgent?: string, platform?: string, maxTouchPoints?: number}} nav */
export function detectOs({ userAgent = '', platform = '', maxTouchPoints = 0 }) {
  if (/iPhone|iPad|Android/i.test(userAgent)) return 'other'
  if (/Win/i.test(platform) || /Windows/i.test(userAgent)) return 'windows'
  // iPadOS Safari claims to be a Mac but has a touch screen
  if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) return maxTouchPoints > 1 ? 'other' : 'mac'
  return 'other'
}

/** @param {{name: string, browser_download_url: string}[]} [assets] */
export function pickAssets(assets) {
  const url = (re) => (assets || []).find((x) => re.test(x.name))?.browser_download_url ?? null
  return {
    windows: url(/\.exe$/i),
    macArm: url(/arm64.*\.dmg$/i),
    macIntel: url(/^(?!.*arm64).*\.dmg$/i), // x64 and the old arch-less name
  }
}

/** @returns {Promise<'arm' | 'x86' | null>} null when the browser cannot tell */
export async function macChip() {
  try {
    const { architecture } = await navigator.userAgentData.getHighEntropyValues(['architecture'])
    return architecture === 'arm' || architecture === 'x86' ? architecture : null
  } catch {
    return null
  }
}

async function init() {
  const win = document.getElementById('heroDownloadWin')
  const mac = document.getElementById('heroDownloadMac')
  const os = detectOs({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  })
  const [release, chip] = await Promise.all([
    fetch(API).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    os === 'mac' ? macChip() : null,
  ])
  const assets = pickAssets(release?.assets)
  if (assets.windows) win.href = assets.windows

  const intel = chip === 'x86'
  const main = intel ? assets.macIntel : assets.macArm
  const other = intel ? assets.macArm : assets.macIntel
  if (main) {
    mac.href = main
    mac.textContent = `Download for macOS (${intel ? 'Intel' : 'Apple silicon'})`
  }
  if (main && other) {
    const sub = document.createElement('p')
    const link = document.createElement('a')
    sub.className = 'cta-sub'
    link.href = other
    link.textContent = `Download the ${intel ? 'Apple silicon' : 'Intel'} build`
    sub.append(`${intel ? 'Apple silicon Mac?' : 'Intel Mac?'} `, link)
    sub.style.margin = '0'
    // Stack the hint under the macOS button; buttons keep their places.
    const column = document.createElement('div')
    column.style.cssText = 'display:flex;flex-direction:column;gap:10px'
    mac.parentElement.style.alignItems = 'flex-start'
    mac.before(column)
    column.append(mac, sub)
  }
  if (os === 'mac') {
    // Only the style moves to the visitor's OS, never the button order.
    win.classList.add('btn-secondary')
    mac.classList.remove('btn-secondary')
  }
}

if (typeof document !== 'undefined') init()
