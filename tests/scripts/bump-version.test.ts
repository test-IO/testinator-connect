import { describe, expect, it } from 'vitest'
import { nextPatchVersion } from '../../scripts/bump-version.mjs'

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

  it('reads the old <version>-<sha> release tags', () => {
    expect(nextPatchVersion({ version: '0.1.0', latestTag: '0.0.1-6ec6cb2' })).toBeNull()
  })
})
