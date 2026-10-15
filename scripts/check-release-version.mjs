import { readFileSync } from 'node:fs'
import { checkReleaseVersion } from './release-version.mjs'

const tag = process.argv[2] ?? ''
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const error = checkReleaseVersion(tag, version)

if (error) {
  console.error(error)
  process.exit(1)
}
console.log(`Releasing ${version}`)
