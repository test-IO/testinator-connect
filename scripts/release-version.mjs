const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/

export function checkReleaseVersion(tag, packageVersion) {
  const match = RELEASE_TAG.exec(tag)
  if (!match) {
    return `Tag "${tag}" is not an app release. Use vX.Y.Z, with no pre-release suffix.`
  }
  if (match[1] !== packageVersion) {
    return `Tag "${tag}" does not match package.json version "${packageVersion}". Bump package.json, commit, and tag that commit v${packageVersion}.`
  }
  return null
}
