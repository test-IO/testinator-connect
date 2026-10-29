// Usage: node scripts/bump-version.mjs <project-dir> [latest-tag]
// Raises the patch version when it is not above the latest release, so a merge releases.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/
const CORE = /^v?(\d+)\.(\d+)\.(\d+)/

function compareCore(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

// Returns the version to set, or null when the current one is already above the latest release.
export function nextPatchVersion({ version, latestTag }) {
  const current = VERSION.exec(version)
  const latest = CORE.exec(latestTag)
  if (!current || !latest) return null

  const currentCore = current.slice(1).map(Number)
  const latestCore = latest.slice(1).map(Number)
  if (compareCore(currentCore, latestCore) > 0) return null
  return `${latestCore[0]}.${latestCore[1]}.${latestCore[2] + 1}`
}

function writeVersion(file, version) {
  const json = JSON.parse(readFileSync(file, 'utf8'))
  json.version = version
  if (json.packages?.['']) json.packages[''].version = version
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, latestTag = ''] = process.argv.slice(2)
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const next = nextPatchVersion({ version, latestTag })
  if (!next) {
    console.log(`${version} is already above ${latestTag || 'the latest release'}; nothing to bump.`)
  } else {
    writeVersion(join(dir, 'package.json'), next)
    writeVersion(join(dir, 'package-lock.json'), next)
    console.log(`Bumped ${version} to ${next}.`)
  }
}
