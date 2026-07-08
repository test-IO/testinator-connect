import type { DeepLinkConfigPayload } from '../shared/ipc-types'

export const DEEP_LINK_PROTOCOL = 'agentic-qa-connect'

// Only extracts deployment_url — no other query param is read, so the deep
// link can't be used to set auth_token/servers/etc. The extracted value must
// itself be an http(s) URL, blocking javascript:/file:/data: from ending up
// as the socket.io connection target.
export function parseDeepLink(rawUrl: string): DeepLinkConfigPayload | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:`) return null
  const path = (parsed.hostname || parsed.pathname.replace(/^\/+/, '')).toLowerCase()
  if (path !== 'configure') return null

  const raw = parsed.searchParams.get('deployment_url')
  if (!raw) return null

  let candidate: URL
  try {
    candidate = new URL(raw)
  } catch {
    return null
  }
  if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') return null

  return { deploymentUrl: candidate.toString() }
}

export function extractDeepLinkUrl(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`)) ?? null
}
