export const VERSION = /^(\d+)\.(\d+)\.(\d+)$/
export const CORE = /^v?(\d+)\.(\d+)\.(\d+)/

export function compareCore(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

// existing: 'none' | 'draft' | 'published' — the GitHub release for v<version>.
// latestTag: tag of the current latest release, or '' when there is none.
export function planRelease({ version, existing, tagExists, latestTag }) {
  const match = VERSION.exec(version)
  if (!match) {
    return { action: 'error', message: `package.json version "${version}" must be X.Y.Z, with no pre-release suffix.` }
  }
  if (existing === 'published') {
    return { action: 'skip', message: `v${version} is already released. Bump package.json to release.` }
  }
  if (existing === 'none' && tagExists) {
    return { action: 'error', message: `Tag v${version} already exists without a release. Pick another version.` }
  }
  const latest = CORE.exec(latestTag)
  if (latest && compareCore(match.slice(1).map(Number), latest.slice(1).map(Number)) <= 0) {
    return {
      action: 'error',
      message: `v${version} is not higher than the latest release ${latestTag}. Apps never downgrade; bump package.json.`
    }
  }
  return { action: 'release', recreateDraft: existing === 'draft', message: `Releasing v${version}` }
}
