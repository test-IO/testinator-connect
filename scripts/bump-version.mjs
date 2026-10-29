// Usage: node scripts/bump-version.mjs <project-dir> [latest-tag]
// Raises the patch version when it is not above the latest release, so a merge releases.
// Prints the new version, or nothing when no bump is needed.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE, VERSION, compareCore } from './release-plan.mjs'

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

// Sets the version in package.json and package-lock.json; returns it, or null when nothing changed.
export function bumpProject(dir, latestTag) {
  const files = ['package.json', 'package-lock.json'].map((name) => {
    const path = join(dir, name)
    return { path, json: JSON.parse(readFileSync(path, 'utf8')) }
  })
  const next = nextPatchVersion({ version: files[0].json.version, latestTag })
  if (!next) return null

  for (const { path, json } of files) {
    json.version = next
    if (json.packages?.['']) json.packages[''].version = next
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
  }
  return next
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, latestTag = ''] = process.argv.slice(2)
  const next = bumpProject(dir, latestTag)
  if (next) console.log(next)
}
