// Usage: node scripts/plan-release.mjs <none|draft|published> <tag-exists:true|false> [latest-tag]
// Prints GitHub Actions outputs; exits 1 when the version cannot be released.
import { readFileSync } from 'node:fs'
import { planRelease } from './release-plan.mjs'

const [existing = 'none', tagExists = 'false', latestTag = ''] = process.argv.slice(2)
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const plan = planRelease({ version, existing, tagExists: tagExists === 'true', latestTag })

if (plan.action === 'error') {
  console.error(plan.message)
  process.exit(1)
}
console.error(plan.message)
console.log(`release=${plan.action === 'release'}`)
console.log(`recreate_draft=${Boolean(plan.recreateDraft)}`)
console.log(`version=${version}`)
console.log(`tag=v${version}`)
