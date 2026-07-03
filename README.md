# Agentic QA - connect

A self-contained desktop app that provides a UI for configuring and monitoring **Agentic QA connect** — the bridge that connects local MCP (Model Context Protocol) servers to a remote Agentic QA tooling instance via Socket.IO.

Built with **Electron 33 + electron-vite + Svelte 5 + TypeScript**.

---

## What this app does

Agentic QA connect sits between a remote orchestrator (the Agentic QA tooling instance) and local MCP servers (e.g. Playwright MCP for browser automation, custom Python tools, HTTP/SSE endpoints). It:

- Discovers tools from configured MCP servers on startup
- Maintains a persistent Socket.IO connection to the remote tooling instance
- Routes tool calls from the orchestrator to the correct local MCP server
- Manages isolated browser sessions per tooling session (stateful mode)
- Provides a real-time dashboard showing connection status, active sessions, and an activity log

The Electron app replaces the Python CLI + TUI that ships in `testinator-connect/`. It runs without requiring Python or Node.js to be pre-installed on the user's machine — Python MCP servers are handled via a bundled `uv` binary.

---

## Architecture overview

```
Agentic QA tooling (remote)
        ↕  Socket.IO
  Agentic QA - connect  (this Electron app)
        ↕  MCP protocol (stdio / HTTP / SSE)
    MCP Servers  (Playwright, custom Python tools, etc.)
        ↕
    Browser / Tools
```

The Electron main process owns the Socket.IO connection and all MCP client logic. The renderer (Svelte) communicates with the main process exclusively through a typed IPC bridge (`src/preload/index.ts` + `src/shared/ipc-types.ts`).

---

## Project structure

```
testinator-connect-electron/
├── electron.vite.config.ts      # Vite config for main / preload / renderer
├── electron-builder.yml         # Packaging config (DMG + NSIS)
├── package.json
├── tsconfig.json
├── tsconfig.node.json           # Main process TS config
├── tsconfig.web.json            # Renderer TS config
│
├── resources/                   # Bundled binaries (not committed — see setup below)
│   ├── uv-macos-arm64           # uv for Apple Silicon
│   ├── uv-macos-x64             # uv for Intel Mac
│   └── uv-windows-x64.exe      # uv for Windows
│
└── src/
    ├── shared/
    │   └── ipc-types.ts         # IPC channel names + payload TypeScript interfaces
    │
    ├── main/                    # Electron main process
    │   ├── index.ts             # BrowserWindow + IPC handler registration
    │   ├── config.ts            # Load/save config.json from userData directory
    │   ├── uv.ts                # Resolves bundled uv path; patches Python commands
    │   └── service/
    │       ├── connect-service.ts   # Orchestrator: tool discovery → Socket.IO startup
    │       ├── socketio-client.ts   # Socket.IO client + all event handlers
    │       ├── session-manager.ts   # Stateful MCP session registry
    │       ├── mcp-client.ts        # MCP client (stdio / HTTP / SSE transports)
    │       └── logger.ts            # IPC event emitter (logs, status, session events)
    │
    ├── preload/
    │   └── index.ts             # contextBridge: exposes window.electronAPI to renderer
    │
    └── renderer/                # Svelte 5 UI
        ├── index.html
        ├── main.ts              # Svelte mount
        ├── App.svelte           # Root: sidebar + Dashboard / Config tab routing
        ├── lib/
        │   ├── ipc.svelte.ts    # Reactive IPC state ($state runes: logs, status, sessions)
        │   └── electronAPI.d.ts # Type declarations for window.electronAPI
        ├── pages/
        │   ├── DashboardPage.svelte  # StatusBar + StatsBar + SessionsTable + ActivityLog
        │   └── ConfigPage.svelte     # Full config form with dynamic MCP server list
        └── components/
            ├── StatusBar.svelte      # Connection indicator + Start/Stop controls
            ├── StatsBar.svelte       # Tools / sessions / calls counters
            ├── SessionsTable.svelte  # Active/ended sessions table
            └── ActivityLog.svelte    # Real-time color-coded log stream
```

---

## Prerequisites

| Tool | Purpose | Notes |
|------|---------|-------|
| Node.js 23 | Build + dev | Pinned via `.nvmrc` — see below |
| npm ≥ 10 | Package manager | Comes with Node |

No Python required — Python MCP servers are handled via a bundled `uv` binary.

---

## Setup

### 1. Switch to the correct Node version

The project ships with an `.nvmrc` pinned to Node 23 (the version used to build and test this app). If you use **nvm**:

```bash
cd testinator-connect-electron
nvm use          # reads .nvmrc and activates Node 23
```

If Node 23 is not installed yet:

```bash
nvm install      # installs the version from .nvmrc and activates it
```

### 2. Install dependencies

```bash
npm install
```

### 3. Download uv binaries (first-time only)

The `resources/` directory needs platform-specific `uv` binaries. They are **not committed** to git because of their size (~40–65 MB each). Run the script below once after cloning:

```bash
# macOS / Linux
curl -sL "https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz" \
  | tar xz -C /tmp uv-aarch64-apple-darwin/uv && mv /tmp/uv-aarch64-apple-darwin/uv resources/uv-macos-arm64

curl -sL "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-apple-darwin.tar.gz" \
  | tar xz -C /tmp uv-x86_64-apple-darwin/uv && mv /tmp/uv-x86_64-apple-darwin/uv resources/uv-macos-x64

curl -sL "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip" \
  -o /tmp/uv-win.zip && unzip -j /tmp/uv-win.zip "uv.exe" -d resources/ && \
  mv resources/uv.exe resources/uv-windows-x64.exe

chmod +x resources/uv-macos-arm64 resources/uv-macos-x64
```

---

## Development

```bash
npm run dev
```

This starts electron-vite in watch mode: the main and preload processes rebuild on save, and the renderer hot-reloads via Vite's dev server at `http://localhost:5173`.

> **Note for VS Code / Claude Code users:** VS Code sets `ELECTRON_RUN_AS_NODE=1` in its extension environment, which prevents Electron from initializing its GUI process. The `npm run dev` script automatically unsets this variable, so running via `npm run dev` works correctly. If you invoke electron directly, prefix with `ELECTRON_RUN_AS_NODE=`.

### Configuration

On first launch, the app shows the Config page (no config file found). Fill in:

- **Deployment URL** — URL of the remote Agentic QA tooling instance
- **Auth Token** — optional bearer token
- **MCP Servers** — one or more server definitions (see below)

Config is saved to the OS user-data directory:
- macOS: `~/Library/Application Support/Agentic QA - connect/config.json`
- Windows: `%APPDATA%\Agentic QA - connect\config.json`

### Config schema

```json
{
  "deployment_url": "https://your-tooling-instance.example.com",
  "auth_token": "",
  "timeout": 120,
  "ssl_verify": false,
  "servers": {
    "Playwright_MCP": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--caps", "vision", "--image-responses", "allow", "--viewport-size", "1280x720", "--timeout-action", "60000", "--isolated"],
      "stateful": true
    },
    "MyPythonTool": {
      "type": "stdio",
      "command": "python",
      "args": ["path/to/my_server.py"],
      "stateful": false
    },
    "RemoteTool": {
      "type": "http",
      "url": "http://localhost:9586/mcp",
      "headers": { "X-User-Token": "secret" },
      "stateful": false
    }
  }
}
```

**Server types:**
- `stdio` — spawns a local subprocess. `command` + `args` required. If `command` is `python`, `python3`, or `uv`, the bundled `uv` binary is used automatically (no Python install needed).
- `http` — connects to a Streamable HTTP MCP server. `url` required.
- `sse` — connects to a Server-Sent Events MCP server. `url` required.

**`stateful: true`** — the server gets a dedicated subprocess per tooling session, providing complete browser isolation between parallel sessions.

---

## CI/CD — Automated builds

The GitHub Actions workflow at [`.github/workflows/build.yml`](.github/workflows/build.yml) automatically builds and packages the app on every push to `main`, on pull requests, and on version tags (`v*.*.*`).

| Trigger | macOS job | Windows job |
|---------|-----------|-------------|
| Push to `main` | DMG (arm64 + x64) | NSIS installer (x64) |
| Pull request | DMG (arm64 + x64) | NSIS installer (x64) |
| Tag `v*.*.*` | DMG + draft GitHub Release | Installer + draft GitHub Release |
| Manual dispatch | DMG | Installer |

Built artifacts are uploaded to each workflow run (Actions → select run → Artifacts).

Code signing is automatic when the [secrets below](#code-signing-setup) are configured. If the secrets are absent (e.g. fork PRs), the workflow builds unsigned packages without failing.

---

## Building for distribution

### macOS (produces `.dmg`)

Run on a Mac:

```bash
npm run dist:mac
```

Output: `dist/Agentic QA - connect-1.0.0-arm64.dmg` and `dist/Agentic QA - connect-1.0.0.dmg`

### Windows (produces `.exe` installer)

Run on Windows:

```bash
npm run dist:win
```

Output: `dist/Agentic QA - connect Setup 1.0.0.exe` (NSIS installer with optional install directory selection)

### Build only (no packaging)

```bash
npm run build
```

Compiles all three processes (main, preload, renderer) to `out/` without packaging.

### Preview packaged build

```bash
npm run preview
```

Runs the last production build locally without packaging.

---

## Code signing setup

Code signing is handled by electron-builder via two environment variables that CI sets from GitHub secrets:

| Environment variable | Secret | Description |
|---------------------|--------|-------------|
| `CSC_LINK` | `mac_certs` / `windows_certs` | Base64-encoded certificate (.p12 / .pfx) |
| `CSC_KEY_PASSWORD` | `mac_certs_password` / `windows_certs_password` | Password for the certificate |

Add secrets in your GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**.

### macOS — Developer ID Application certificate

Requires an [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year).

1. Sign in to [developer.apple.com](https://developer.apple.com) → **Certificates, Identifiers & Profiles** → **Certificates** → **+**
2. Select **Developer ID Application** (for distribution outside the Mac App Store) and follow the Certificate Signing Request wizard.
3. Download the `.cer` file and double-click to install it into Keychain Access.
4. Open **Keychain Access** → **My Certificates** → find the certificate (it should have a private key arrow beneath it) → right-click → **Export** → choose **Personal Information Exchange (.p12)** format → set a strong password.
5. Base64-encode the `.p12` file:
   ```bash
   base64 -i certificate.p12 | pbcopy   # copies to clipboard on macOS
   ```
6. Add GitHub secret **`mac_certs`**: paste the base64 string.
7. Add GitHub secret **`mac_certs_password`**: the password you set in step 4.

> **Notarization:** The current config has `notarize: false` in `electron-builder.yml`. Apple requires notarization for Gatekeeper acceptance on macOS 10.15+. To enable it, set `notarize: true` and add three more secrets: `APPLE_ID` (your Apple ID email), `APPLE_APP_PASSWORD` (an [app-specific password](https://support.apple.com/en-us/102654)), and `APPLE_TEAM_ID` (your 10-character Team ID from developer.apple.com).

### Windows — Code signing certificate

#### Option A — Self-signed certificate (development / testing only)

Self-signed certificates are **not trusted by Windows SmartScreen** and will trigger a warning for end users. Use this only for internal testing.

Run in an **elevated PowerShell** on Windows:

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigning `
  -Subject "CN=Agentic QA" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddYears(3)

$pwd = ConvertTo-SecureString "YourCertPassword" -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath certificate.pfx -Password $pwd
```

Then base64-encode the `.pfx`:

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Clipboard
```

```bash
# macOS / Linux
base64 -i certificate.pfx | pbcopy
```

#### Option B — Commercial certificate (production)

Commercial certificates are issued by Microsoft-trusted Certificate Authorities and avoid SmartScreen reputation warnings. EV (Extended Validation) certificates are immediately trusted with no reputation-building period required.

Recommended CAs: [DigiCert](https://www.digicert.com/signing/code-signing-certificates), [Sectigo](https://sectigo.com/ssl-certificates-tls/code-signing), [GlobalSign](https://www.globalsign.com/en/code-signing-certificate).

1. Purchase a **Code Signing** certificate (OV or EV) from a trusted CA.
2. Complete their identity verification process (OV: organization validation; EV: extended validation with stricter checks).
3. The CA will issue the certificate. Export it as a `.pfx` file with a password using their portal or the Windows Certificate Manager.
4. Base64-encode the `.pfx` as shown in Option A above.

#### Registering the Windows secrets

5. Add GitHub secret **`windows_certs`**: paste the base64 string.
6. Add GitHub secret **`windows_certs_password`**: the password protecting the `.pfx`.

---

## IPC architecture

The app uses Electron's `contextBridge` for secure communication between the renderer and main process.

**Renderer → Main** (invoked via `window.electronAPI`):

| Method | Description |
|--------|-------------|
| `loadConfig()` | Read config from disk |
| `saveConfig(config)` | Write config to disk |
| `startService()` | Discover tools + connect to tooling |
| `stopService()` | Disconnect + clean up sessions |

**Main → Renderer** (subscribed via `window.electronAPI.on*`):

| Event | Payload | Description |
|-------|---------|-------------|
| `onLogEntry` | `LogEntry` | Activity log entry (timestamped, level-tagged) |
| `onStatusChanged` | `StatusPayload` | Connected/disconnected + URL |
| `onSessionUpdated` | `SessionRecord` | Session created or call count updated |
| `onSessionRemoved` | `{ sessionId }` | Session ended |
| `onStatsUpdated` | `{ totalTools?, totalCalls? }` | Stat counters updated |

All channel names and payload types are defined in [`src/shared/ipc-types.ts`](src/shared/ipc-types.ts).

---

## Python MCP servers (uv integration)

When a server config uses `command: "python"`, `"python3"`, or `"uv"`, the app automatically substitutes the bundled `uv` binary. This means:

1. Users do **not** need Python installed.
2. On first use of a Python server, `uv` downloads and caches the required Python version silently (~50 MB, one-time).
3. Subsequent launches are instant.

The substitution logic lives in [`src/main/uv.ts`](src/main/uv.ts). Platform binaries are stored in `resources/` and copied into the app bundle by electron-builder via `extraResources`.

---

## Key dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^33 | App shell |
| `electron-vite` | ^2 | Vite-based build tool |
| `svelte` | ^5 | Renderer UI framework |
| `@sveltejs/vite-plugin-svelte` | ^4 | Svelte Vite integration |
| `socket.io-client` | ^4.7 | Socket.IO client for tooling connection |
| `@modelcontextprotocol/sdk` | ^1 | MCP client (stdio / HTTP / SSE) |
| `electron-builder` | ^25 | Packaging (DMG + NSIS) |

---

## Relationship to `testinator-connect`

This Electron app is a **TypeScript port** of the Python `testinator-connect` package (located at `../testinator-connect/`). The core logic maps as follows:

| Python module | TypeScript equivalent |
|---|---|
| `sio.py` | `src/main/service/socketio-client.ts` |
| `session_manager.py` | `src/main/service/session-manager.ts` |
| `config.py` | `src/main/config.ts` |
| `utils.py` | `src/main/config.ts` (inline `sanitizeServerName`) |
| `console.py` | `src/main/service/logger.ts` |
| `tui.py` | `src/renderer/` (Svelte components) |

When the Python source changes, the corresponding TypeScript file(s) need to be updated to stay in sync. The key behavioral invariants to preserve are:

- **Sessions survive disconnect** — `sessionManager.cleanupAll()` is NOT called on Socket.IO disconnect; sessions are preserved for reconnection and only cleaned up on explicit `mcp_session_end` or app quit.
- **`mcp_connect` uses ack** — the connect event uses `socket.timeout(30000).emitWithAck('mcp_connect', payload)` with a plain `emit` fallback, matching the Python `sio.call()` behavior.
- **Client ID** — a stable 16-char hex ID is generated from `sha256(auth_token || deployment_url)` and sent as both an `X-Client-ID` header and a `client_id` field in the `mcp_connect` payload.
