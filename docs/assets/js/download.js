// Points the landing-page download buttons at the installers of the latest release.
// Without JS the buttons keep their static hrefs (the release page).
// releases/latest/download/<name> always serves the newest file: the names carry no
// version (artifactName in electron-builder.yml) — keep them in sync.
const LATEST = 'https://github.com/test-IO/testinator-connect/releases/latest/download/'
export const DOWNLOADS = {
  windows: LATEST + 'Agentic-QA-Connect-Setup-win-x64.exe',
  macArm: LATEST + 'Agentic-QA-Connect-mac-arm64.dmg',
  macIntel: LATEST + 'Agentic-QA-Connect-mac-x64.dmg',
}

/** @param {{userAgent?: string, platform?: string, maxTouchPoints?: number}} nav */
export function detectOs({ userAgent = '', platform = '', maxTouchPoints = 0 }) {
  if (/iPhone|iPad|Android/i.test(userAgent)) return 'other'
  if (/Win/i.test(platform) || /Windows/i.test(userAgent)) return 'windows'
  // iPadOS Safari claims to be a Mac but has a touch screen
  if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) return maxTouchPoints > 1 ? 'other' : 'mac'
  return 'other'
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
  const chip = os === 'mac' ? await macChip() : null
  win.href = DOWNLOADS.windows

  const intel = chip === 'x86'
  mac.href = intel ? DOWNLOADS.macIntel : DOWNLOADS.macArm
  mac.textContent = `Download for macOS (${intel ? 'Intel' : 'Apple silicon'})`
  const other = intel ? DOWNLOADS.macArm : DOWNLOADS.macIntel
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
  if (os === 'mac') {
    // Only the style moves to the visitor's OS, never the button order.
    win.classList.add('btn-secondary')
    mac.classList.remove('btn-secondary')
  }
}

if (typeof document !== 'undefined') init()
