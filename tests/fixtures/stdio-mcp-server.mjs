// Minimal stdio MCP server for tests. Writes its pid to the file given as the first argument
// so a test can check that the process is gone.
import { writeFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

writeFileSync(process.argv[2], String(process.pid))
const server = new McpServer({ name: 'fixture', version: '1.0.0' })
server.tool('ping', async () => ({ content: [{ type: 'text', text: 'pong' }] }))
await server.connect(new StdioServerTransport())
