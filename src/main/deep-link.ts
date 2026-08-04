import type { DeepLinkConfigPayload } from '../shared/ipc-types'

export const DEEP_LINK_PROTOCOL = 'agentic-qa-connect'

// Reads deployment_url plus the optional quick-connect pair (exchange_url +
// code) — never a token or server config, so the link itself can't hand the app
// a credential or an MCP server. Both URLs must be http(s), which blocks
// javascript:/file:/data: from becoming a connection or request target.
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

  const deploymentUrl = httpUrl(raw)
  if (!deploymentUrl) return null

  const exchangeUrl = httpUrl(parsed.searchParams.get('exchange_url'))
  const code = parsed.searchParams.get('code')
  if (!exchangeUrl || !code) return { deploymentUrl }

  return { deploymentUrl, exchangeUrl, code }
}

function httpUrl(raw: string | null): string | null {
  if (!raw) return null
  let candidate: URL
  try {
    candidate = new URL(raw)
  } catch {
    return null
  }
  if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') return null
  return candidate.toString()
}

export function extractDeepLinkUrl(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`)) ?? null
}
