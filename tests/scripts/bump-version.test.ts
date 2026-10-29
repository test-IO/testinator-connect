import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bumpProject, nextPatchVersion } from '../../scripts/bump-version.mjs'

describe('nextPatchVersion', () => {
  it('bumps the patch of the latest release when the version equals it', () => {
    expect(nextPatchVersion({ version: '0.1.0', latestTag: 'v0.1.0' })).toBe('0.1.1')
  })

  it('bumps from the latest release when the version is below it', () => {
    expect(nextPatchVersion({ version: '0.1.0', latestTag: 'v0.2.3' })).toBe('0.2.4')
  })

  it('leaves a version already above the latest release', () => {
    expect(nextPatchVersion({ version: '0.1.1', latestTag: 'v0.1.0' })).toBeNull()
  })

  it('leaves the version when there is no release to compare with', () => {
    expect(nextPatchVersion({ version: '0.1.0', latestTag: '' })).toBeNull()
  })

  it('leaves a version above an old <version>-<sha> release', () => {
    expect(nextPatchVersion({ version: '0.1.0', latestTag: '0.0.1-6ec6cb2' })).toBeNull()
  })

  it('bumps a version equal to the core of an old <version>-<sha> release', () => {
    expect(nextPatchVersion({ version: '0.0.1', latestTag: '0.0.1-6ec6cb2' })).toBe('0.0.2')
  })
})

describe('bumpProject', () => {
  function project(version: string) {
    const dir = mkdtempSync(join(tmpdir(), 'bump-'))
    const pkg = { name: 'app', version }
    const lock = { name: 'app', version, lockfileVersion: 3, packages: { '': { name: 'app', version } } }
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
    writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    return dir
  }
  const read = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'))

  it('writes the new version to package.json and both lockfile entries', () => {
    const dir = project('0.1.0')
    expect(bumpProject(dir, 'v0.1.0')).toBe('0.1.1')
    expect(read(dir, 'package.json').version).toBe('0.1.1')
    expect(read(dir, 'package-lock.json').version).toBe('0.1.1')
    expect(read(dir, 'package-lock.json').packages[''].version).toBe('0.1.1')
  })

  it('changes nothing when the version is already above the latest release', () => {
    const dir = project('0.1.1')
    const before = readFileSync(join(dir, 'package.json'), 'utf8')
    expect(bumpProject(dir, 'v0.1.0')).toBeNull()
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)
  })

  it('writes nothing when the lockfile is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bump-'))
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ version: '0.1.0' })}\n`)
    expect(() => bumpProject(dir, 'v0.1.0')).toThrow()
    expect(read(dir, 'package.json').version).toBe('0.1.0')
  })

  it('sets both versions when the lockfile root differs from package.json', () => {
    const dir = project('0.1.0')
    const lock = read(dir, 'package-lock.json')
    lock.version = '0.0.1'
    lock.packages[''].version = '0.0.1'
    writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    expect(bumpProject(dir, 'v0.1.0')).toBe('0.1.1')
    expect(read(dir, 'package-lock.json').version).toBe('0.1.1')
    expect(read(dir, 'package-lock.json').packages[''].version).toBe('0.1.1')
  })

  it('handles a lockfile without a root package entry', () => {
    const dir = project('0.1.0')
    const lock = read(dir, 'package-lock.json')
    delete lock.packages['']
    writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    expect(bumpProject(dir, 'v0.1.0')).toBe('0.1.1')
    expect(read(dir, 'package-lock.json').version).toBe('0.1.1')
  })
})

describe('bump-version CLI', () => {
  const script = join(__dirname, '../../scripts/bump-version.mjs')
  const run = (dir: string, latest: string) => execFileSync('node', [script, dir, latest], { encoding: 'utf8' })

  function project(version: string) {
    const dir = mkdtempSync(join(tmpdir(), 'bump-cli-'))
    const lock = { version, lockfileVersion: 3, packages: { '': { version } } }
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ version }, null, 2)}\n`)
    writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    return dir
  }

  it('prints the new version when it bumps', () => {
    expect(run(project('0.1.0'), 'v0.1.0')).toBe('0.1.1\n')
  })

  it('prints nothing when there is nothing to bump', () => {
    expect(run(project('0.1.1'), 'v0.1.0')).toBe('')
  })

  it('prints nothing without a latest release', () => {
    expect(run(project('0.1.0'), '')).toBe('')
  })
})
