import { describe, expect, it } from 'vitest'
import { planRelease } from '../../scripts/release-plan.mjs'

const base = { version: '0.2.0', existing: 'none', tagExists: false, latestTag: 'v0.1.0' }

describe('planRelease', () => {
  it('releases a new version higher than the latest', () => {
    expect(planRelease(base)).toMatchObject({ action: 'release', recreateDraft: false })
  })

  it('skips a version that is already released', () => {
    expect(planRelease({ ...base, existing: 'published', tagExists: true }).action).toBe('skip')
  })

  it('retries over a draft left by a failed run', () => {
    expect(planRelease({ ...base, existing: 'draft' })).toMatchObject({ action: 'release', recreateDraft: true })
  })

  it('releases when there is no release yet', () => {
    expect(planRelease({ ...base, latestTag: '' }).action).toBe('release')
  })

  it('treats the old <version>-<sha> releases as lower than X.Y.Z', () => {
    expect(planRelease({ ...base, version: '0.1.0', latestTag: '0.0.1-6ec6cb2' }).action).toBe('release')
  })

  it('rejects a version not higher than the latest', () => {
    expect(planRelease({ ...base, version: '0.0.9' }).message).toContain('not higher')
    expect(planRelease({ ...base, version: '0.1.0' }).action).toBe('error')
  })

  it('rejects a tag that exists without a release, like old platform tags', () => {
    expect(planRelease({ ...base, version: '1.10.11', tagExists: true }).message).toContain('already exists')
  })

  it('rejects pre-release versions', () => {
    expect(planRelease({ ...base, version: '0.2.0-beta.1' }).message).toContain('X.Y.Z')
  })
})
