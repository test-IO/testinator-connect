import { describe, expect, it } from 'vitest'
import { checkReleaseVersion } from '../../scripts/release-version.mjs'

describe('checkReleaseVersion', () => {
  it('accepts vX.Y.Z matching package.json', () => {
    expect(checkReleaseVersion('v0.2.0', '0.2.0')).toBeNull()
  })

  it('rejects a tag without the v prefix', () => {
    expect(checkReleaseVersion('0.2.0', '0.2.0')).toContain('vX.Y.Z')
  })

  it('rejects pre-release tags, which would become the latest release', () => {
    expect(checkReleaseVersion('v0.2.0-beta.1', '0.2.0-beta.1')).toContain('vX.Y.Z')
  })

  it('rejects customer and other prefixed tags', () => {
    expect(checkReleaseVersion('customer-v0.2.0', '0.2.0')).toContain('vX.Y.Z')
  })

  it('rejects a tag that differs from package.json', () => {
    const error = checkReleaseVersion('v0.2.1', '0.2.0')
    expect(error).toContain('v0.2.1')
    expect(error).toContain('0.2.0')
  })

  it('rejects an empty tag', () => {
    expect(checkReleaseVersion('', '0.2.0')).not.toBeNull()
  })
})
