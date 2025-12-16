# testinator-connect

Connect local MCP servers (like Playwright MCP) to a remote testinator-tooling instance via Socket.IO.

## Installation

```bash
cd testinator_connect
uv sync
```

## Configuration

1. Copy the example configuration:
   ```bash
   cp config.example.json config.json
   ```

2. Edit `config.json` with your settings:
   ```json
   {
     "deployment_url": "https://tooling.testinator.ai",
     "auth_token": "YOUR_AUTH_TOKEN_HERE",
     "project_id": 465,
     "timeout": 120,
     "ssl_verify": false,
     "servers": {
       "Playwright_MCP": {
         "type": "stdio",
         "command": "npx",
         "args": [
           "@playwright/mcp@latest",
           "--caps", "vision",
           "--image-responses", "allow",
           "--viewport-size", "1280x720",
           "--timeout-action", "60000"
         ],
         "stateful": true
       }
     }
   }
   ```

## Usage

```bash
# Run with uv
uv run testinator-connect serve

# Or if installed
testinator-connect serve
```

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `deployment_url` | string | URL of testinator-tooling instance |
| `auth_token` | string | Authorization token |
| `project_id` | integer | Project ID for identification |
| `timeout` | integer | Tool call timeout in seconds (default: 120) |
| `ssl_verify` | boolean | Enable SSL verification (default: false) |
| `servers` | object | Dictionary of MCP server configurations |

### Server Configuration

Each server in `servers` can be one of three types:

**stdio** (subprocess):
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["@playwright/mcp@latest"],
  "stateful": true
}
```

**sse** (Server-Sent Events):
```json
{
  "type": "sse",
  "url": "https://example.com/sse",
  "headers": {"Authorization": "Bearer token"}
}
```

**http** (Streamable HTTP):
```json
{
  "type": "http",
  "url": "https://example.com/api",
  "headers": {"Authorization": "Bearer token"}
}
```

Set `"stateful": true` to maintain persistent connections between tool calls.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESTINATOR_DISABLE_SSL_VERIFY` | Set to "true" to disable SSL verification |

## How It Works

1. On startup, testinator-connect:
   - Loads configuration from `config.json`
   - Connects to each configured MCP server
   - Discovers available tools
   - Establishes Socket.IO connection to testinator-tooling
   - Registers all tools with the platform

2. When testinator-tooling requests a tool call:
   - testinator-connect routes the request to the appropriate MCP server
   - Executes the tool with the provided arguments
   - Returns the result (including any images/binary data)

3. Stateful servers maintain persistent connections for:
   - Faster subsequent tool calls
   - Session state preservation (e.g., browser state in Playwright)
