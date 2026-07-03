import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ServerConfig } from '../../shared/ipc-types'
import { resolveCommand } from '../uv'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: string
    properties: Record<string, unknown>
    required: string[]
  }
}

export interface ServerToolInfo {
  name: string
  tools: ToolDefinition[]
}

export interface ResourceDefinition {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface ServerResourceInfo {
  name: string
  resources: ResourceDefinition[]
}

export interface LiveSession {
  client: Client
  close: () => Promise<void>
}

function makeClient(): Client {
  return new Client(
    { name: 'agentic-qa-connect', version: '1.0.0' },
    { capabilities: {} },
  )
}

function buildTransport(conf: ServerConfig) {
  const type = conf.type ?? 'stdio'
  if (type === 'stdio') {
    const resolved = resolveCommand(conf.command ?? '', conf.args ?? [])
    return new StdioClientTransport({
      command: resolved.command,
      args: resolved.args,
      env: resolved.env ? { ...process.env, ...resolved.env } as Record<string, string> : undefined,
    })
  }
  if (type === 'sse') {
    return new SSEClientTransport(new URL(conf.url!), {
      requestInit: { headers: conf.headers },
    })
  }
  // http / streamable
  return new StreamableHTTPClientTransport(new URL(conf.url!), {
    requestInit: { headers: conf.headers },
  })
}

export interface ServerDiscoveryResult {
  name: string
  tools: ToolDefinition[]
  resources: ResourceDefinition[]
}

export async function discoverServer(
  serverName: string,
  conf: ServerConfig,
): Promise<ServerDiscoveryResult> {
  const client = makeClient()
  const transport = buildTransport(conf)
  try {
    await client.connect(transport)

    const toolsRes = await client.listTools()
    const tools: ToolDefinition[] = toolsRes.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: {
        type: (t.inputSchema as { type?: string }).type ?? 'object',
        properties: (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
        required: (t.inputSchema as { required?: string[] }).required ?? [],
      },
    }))

    let resources: ResourceDefinition[] = []
    if (client.getServerCapabilities()?.resources) {
      const resourcesRes = await client.listResources()
      resources = (resourcesRes.resources ?? []).map((r) => ({
        uri: String(r.uri),
        name: r.name ?? String(r.uri),
        description: r.description,
        mimeType: r.mimeType,
      }))
    }

    return { name: serverName, tools, resources }
  } finally {
    await client.close().catch(() => {})
  }
}

export async function discoverServerTools(
  serverName: string,
  conf: ServerConfig,
): Promise<ServerToolInfo> {
  const result = await discoverServer(serverName, conf)
  return { name: result.name, tools: result.tools }
}


export async function readResourceStateless(
  conf: ServerConfig,
  uri: string,
): Promise<unknown> {
  const client = makeClient()
  const transport = buildTransport(conf)
  try {
    await client.connect(transport)
    const res = await client.readResource({ uri })
    return res.contents
  } finally {
    await client.close().catch(() => {})
  }
}

// Wire shape for a serialized MCP tool result. Matches what the
// Python `testinator-connect` emits, so downstream (testinator-tooling's
// `_translate_response` / `_normalize_content_blocks`) handles both
// clients uniformly.
export interface SerializedToolResult {
  isError: boolean
  content: ContentBlock[]
}

// One content block as defined by the MCP spec. Type-discriminated
// union — we keep the raw SDK shape (`data` + `mimeType` for images,
// `text` for text). Tooling translates `data` → `base64` and
// `mimeType` → `mime_type` so the runner can feed images straight
// into LangChain multimodal messages.
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType?: string }
  | { type: 'audio'; data: string; mimeType?: string }
  | { type: 'resource'; resource: unknown }
  | { type: 'resource_link'; uri: string; name?: string; description?: string; mimeType?: string }
  | { type: string; [k: string]: unknown }

export async function callToolStateless(
  conf: ServerConfig,
  toolName: string,
  arguments_: Record<string, unknown>,
): Promise<SerializedToolResult> {
  const client = makeClient()
  const transport = buildTransport(conf)
  try {
    await client.connect(transport)
    const res = await client.callTool({ name: toolName, arguments: arguments_ })
    return serializeToolResult(res)
  } finally {
    await client.close().catch(() => {})
  }
}

export async function openPersistentSession(conf: ServerConfig): Promise<LiveSession> {
  const client = makeClient()
  const transport = buildTransport(conf)
  await client.connect(transport)
  return {
    client,
    close: () => client.close().catch(() => {}),
  }
}

// Preserve per-block type info instead of flattening to strings.
//
// History: the previous implementation did
//     content.map(item => item.text ?? item.data ?? String(item))
// which dropped the `type` discriminator entirely. ImageContent blocks
// (which carry their base64 in `data`, not `text`) then arrived
// downstream as bare strings. tooling/runner had to guess what they
// were and ended up materializing them as TextContent — so the runner
// log showed image blocks as `{"type": "text", "text": "/9j/..."}`,
// LangChain couldn't multimodal-render them, and the workflow UI
// gallery never received an image URL.
//
// New shape mirrors what Python `testinator-connect`'s
// `_serialize_tool_result` produces — `{isError, content: [block...]}`
// — so both clients are interchangeable on the wire.
export function serializeToolResult(
  result: { isError?: boolean; content?: unknown[] } | undefined | null,
): SerializedToolResult {
  const rawBlocks = Array.isArray(result?.content) ? result!.content : []
  const content: ContentBlock[] = rawBlocks.map((item) => {
    if (item && typeof item === 'object') {
      // Strip null/undefined fields so the JS wire payload matches what the
      // Python client produces via `model_dump(exclude_none=True)`. The two
      // clients must be interchangeable on the wire; stray `null` fields can
      // trip strict Pydantic validation in the downstream runner.
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (v !== undefined && v !== null) out[k] = v
      }
      // Some real-world MCP servers omit the `type` field despite the spec
      // requiring it. The downstream runner pattern-matches on `type` to route
      // image/text/resource blocks — a missing type would cause it to crash or
      // silently drop the block.
      if (typeof out.type !== 'string') out.type = 'unknown'
      return out as ContentBlock
    }
    // Some legacy (pre-spec) servers return content as bare strings instead of
    // typed blocks, e.g. `["some text"]` rather than `[{type:"text",text:"..."}]`.
    // Wrapping keeps the downstream contract uniform.
    return { type: 'text', text: String(item) }
  })

  return {
    isError: Boolean(result?.isError),
    content,
  }
}
