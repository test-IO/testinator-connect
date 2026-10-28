# Agentic QA - connect

A self-contained desktop app that provides a UI for configuring and monitoring **Agentic QA connect** — the bridge that connects local MCP (Model Context Protocol) servers to the Agentic QA platform, over a Socket.IO link to the remote Agentic QA connect-gateway.

Built with **Electron 33 + electron-vite + Svelte 5 + TypeScript**.

---

## What this app does

Agentic QA connect sits between the Agentic QA platform (it talks to the connect-gateway, which relays work from Agentic QA tooling) and local MCP servers (e.g. Playwright MCP for browser automation, custom Python tools, HTTP/SSE endpoints). It:

- Discovers tools from configured MCP servers on startup
- Maintains a persistent Socket.IO connection to the remote connect-gateway
- Routes incoming tool calls to the correct local MCP server
- Manages isolated browser sessions per remote session (stateful mode)
- Provides a real-time dashboard showing connection status, active sessions, and an activity log

This Electron app replaces the earlier Python CLI + TUI client that used to live in this repo. It runs without requiring Python or Node.js to be pre-installed on the user's machine — Python MCP servers are handled via a bundled `uv` binary.

---

## Architecture overview

```
Agentic QA connect-gateway (remote)
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
testinator-connect/
├── electron.vite.config.ts      # Vite config for main / preload / renderer
├── electron-builder.yml         # Packaging config (DMG + NSIS)
├── electron-builder.win-signed.yml  # Adds Windows signing (USB token)
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

## Website and user guide (`docs/`)

`docs/` is the public website, published by GitHub Pages at
**https://connect.testinator.ai** — it is not part of the app.

```
docs/
├── index.html                # Landing page (download buttons, overview)
├── CNAME                     # Custom domain for GitHub Pages — do not edit or delete
├── assets/
│   ├── images/               # Landing images (logo)
│   └── js/download.js        # Picks the installer for the visitor's OS / Mac chip
└── guide/
    ├── index.html            # Usage guide → https://connect.testinator.ai/guide/
    └── assets/images/        # Guide screenshots
```

- Pages serves `main`, folder `/docs`, as-is (plain HTML, no build step). A merge to
  `main` that changes `docs/` is live in a minute or two.
- A change that touches only `docs/` (or `tests/site/`) runs the Site check
  (`npm run test:site`) and skips the app build; it never produces an app release.
- `docs/` is excluded from the packaged app (`electron-builder.yml`).
- `dev-docs/` holds developer notes — not published.
- Editing with an AI agent: `.claude/rules/docs-site.md` (how the site is set up and
  how to contribute) and `.claude/skills/docs-editing/` (how to work with a
  non-developer) are picked up by Claude Code automatically.

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
cd testinator-connect
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

- **Deployment URL** — URL of the remote Agentic QA connect-gateway
- **Auth Token** — handshake token issued in the platform (Admin → Settings → Agentic QA Connect); the gateway refuses the connection without a valid one
- **MCP Servers** — one or more server definitions (see below)

Config is saved to the OS user-data directory:
- macOS: `~/Library/Application Support/Agentic QA - connect/config.json`
- Windows: `%APPDATA%\Agentic QA - connect\config.json`

### Config schema

```json
{
  "deployment_url": "https://your-connect-gateway.example.com",
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

**`stateful: true`** — the server gets a dedicated subprocess per remote session, providing complete browser isolation between parallel sessions.

### Recommended macOS servers

For desktop-app testing, `MacOS_MCP` first:

```json
"MacOS_MCP": {
  "command": "uv",
  "args": ["tool", "run", "macos-mcp", "serve", "--transport", "stdio"]
}
```

`Peekaboo_MCP` as a second option:

```json
"Peekaboo_MCP": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "-p", "@steipete/peekaboo", "peekaboo-mcp"],
  "stateful": true
}
```

Both need Accessibility and Screen Recording permissions. Enable one at a time.

---

## CI/CD — Automated builds

Two GitHub Actions workflows build the app:

| Workflow | Runs on | Does |
|----------|---------|------|
| [`build.yml`](.github/workflows/build.yml) | every push and every pull request into `main` (skipped when only `docs/`, `dev-docs/`, `tests/site/` or `.claude/` change) | tests, then builds unsigned macOS (DMG + ZIP, arm64 + x64) and Windows (NSIS, x64) packages to check that the app still packages; nothing is published |
| [`release.yml`](.github/workflows/release.yml) | push to `main` | releases only when `version` in `package.json` is new: tests, builds the signed and notarized macOS installers into a draft GitHub Release. `npm run release:win` on the computer with the Windows signing token adds the signed Windows installer and publishes it as `releases/latest` (what running apps update to) |

How to cut a release, version rules and signing: [RELEASING.md](RELEASING.md).

---

## Building for distribution

### macOS (produces `.dmg`)

Run on a Mac:

```bash
npm run dist:mac
```

Output: `dist/Agentic-QA-Connect-mac-arm64.dmg` and `dist/Agentic-QA-Connect-mac-x64.dmg`, plus the matching `.zip` files the updater uses

### Windows (produces `.exe` installer)

Run on Windows:

```bash
npm run dist:win            # signed: needs the SafeNet token with the test IO GmbH certificate
npm run dist:win:unsigned   # any Windows machine
```

Output: `dist/Agentic-QA-Connect-Setup-win-x64.exe` (NSIS installer with optional install directory selection)

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

- **macOS:** CI signs with the certificate in the `CSC_LINK` / `CSC_KEY_PASSWORD` secrets.
- **Windows:** the Sectigo certificate is on a SafeNet USB token, so releases are signed on the
  computer with the token: [RELEASING.md](RELEASING.md#windows-signing).

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
6. Add GitHub secret **`CSC_LINK`**: paste the base64 string.
7. Add GitHub secret **`CSC_KEY_PASSWORD`**: the password you set in step 4.

> **Notarization:** macOS release builds are signed and notarized (`notarize: true` in `electron-builder.yml`); the release workflow also needs `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Secrets, log checks and the `MAC_SIGNING_ENABLED` switch: [RELEASING.md](RELEASING.md#macos-signing).

---

## IPC architecture

The app uses Electron's `contextBridge` for secure communication between the renderer and main process.

**Renderer → Main** (invoked via `window.electronAPI`):

| Method | Description |
|--------|-------------|
| `loadConfig()` | Read config from disk |
| `saveConfig(config)` | Write config to disk |
| `startService()` | Discover tools + connect to the gateway |
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

**windows-mcp is pinned to Python 3.14** (`--python 3.14` is injected for `uvx`/`uv ... run` when the args name `windows-mcp`, unless you pass your own `--python`/`-p`). windows-mcp only requires `>=3.14`, so without the pin `uv` picks the newest interpreter (3.15+), where dependencies such as `pyyaml` have no wheels yet and fall back to a source build that fails with "Microsoft Visual C++ 14.0 or greater is required". Drop the pin once those wheels exist.

The substitution logic lives in [`src/main/uv.ts`](src/main/uv.ts). Platform binaries are stored in `resources/` and copied into the app bundle by electron-builder via `extraResources`.

---

## Key dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^33 | App shell |
| `electron-vite` | ^2 | Vite-based build tool |
| `svelte` | ^5 | Renderer UI framework |
| `@sveltejs/vite-plugin-svelte` | ^4 | Svelte Vite integration |
| `socket.io-client` | ^4.7 | Socket.IO client for the gateway connection |
| `@modelcontextprotocol/sdk` | ^1 | MCP client (stdio / HTTP / SSE) |
| `electron-builder` | ^25 | Packaging (DMG + NSIS) |

---
