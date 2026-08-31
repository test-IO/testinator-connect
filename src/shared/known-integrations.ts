import type { ServerConfig } from './ipc-types'

export interface KnownIntegration {
  id: string
  label: string
  description: string
  defaultServerName: string
  conf: ServerConfig
}

// Pre-filled launch configs for the MCP servers the platform recognizes.
// The platform identifies a driver by server name alone: a registered
// server named exactly "windows_mcp" or "terminator" counts as that
// driver. `defaultServerName` sets that identity. McpServersPage locks the
// name field once it matches one of these ids, so the name can't drift
// away from what the platform looks for.
//
// Both current entries are Windows-only, so the catalog is only offered
// when process.platform === 'win32'.
//
// `stateful: true` on both: a desktop driver has to keep talking to the
// same process across tool calls. Otherwise every call would respawn the
// server and lose the app it was driving.
export const KNOWN_INTEGRATIONS: KnownIntegration[] = [
  {
    id: 'windows_mcp',
    label: 'Windows MCP',
    description: 'UI-tree automation for Windows desktop applications.',
    defaultServerName: 'windows_mcp',
    conf: {
      type: 'stdio',
      // TODO: verify the real windows-mcp invocation. No confirmed launch
      // command for it exists anywhere in the platform yet, so this is an
      // unverified placeholder — correct it here once the real one is known.
      command: 'uvx',
      args: ['windows-mcp@latest'],
      stateful: true,
    },
  },
  {
    id: 'terminator',
    label: 'Terminator',
    description: 'Windows desktop automation with selector, tree-index and coordinate targeting.',
    defaultServerName: 'terminator',
    conf: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'terminator-mcp-agent@latest'],
      stateful: true,
    },
  },
]
