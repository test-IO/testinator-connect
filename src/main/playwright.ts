import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn } from 'child_process'

// Run Electron's own binary as plain Node (via ELECTRON_RUN_AS_NODE) instead of
// relying on a system-installed `node` on PATH, which packaged end-user installs
// often don't have.
export function findNode(): string {
  return process.execPath
}

export function getNodeModulesRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
  }
  return path.join(__dirname, '..', '..', 'node_modules')
}

function getPlaywrightCliPath(): string {
  const nodeModulesRoot = getNodeModulesRoot()
  // npm hoists playwright to the top level in most cases
  const hoisted = path.join(nodeModulesRoot, 'playwright', 'cli.js')
  if (fs.existsSync(hoisted)) return hoisted
  // On Windows (or when npm doesn't hoist), playwright may be nested under @playwright/mcp
  const nested = path.join(nodeModulesRoot, '@playwright', 'mcp', 'node_modules', 'playwright', 'cli.js')
  if (fs.existsSync(nested)) return nested
  return hoisted
}

export function getPlaywrightBrowsersPath(): string {
  return path.join(app.getPath('userData'), 'playwright-browsers')
}

export function isPlaywrightMcpCommand(command: string, args: string[]): boolean {
  return command === 'npx' && (args[0] ?? '').startsWith('@playwright/mcp')
}

// Chrome 149 backgrounds the tab after a link-click navigation, stopping the
// frames page.screenshot() waits for (EPMTIOOPS-20076; mirrors tooling).
const CHROMIUM_LAUNCH_ARGS = ['--disable-features=CalculateNativeWinOcclusion']

// Passed via PLAYWRIGHT_MCP_CONFIG, not --config: the Config page rebuilds the
// arg list from the flags it knows and would drop it. A user's own config is
// merged in, since @playwright/mcp would otherwise let it replace ours.
function writeMcpConfig(userConfigPath?: string): string {
  let config: { browser?: { launchOptions?: { args?: string[] } } } = {}
  if (userConfigPath) {
    try {
      config = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'))
    } catch {
      // Malformed: our args alone beat a browser that hangs on every link click.
    }
  }
  const browser = (config.browser ??= {})
  const launchOptions = (browser.launchOptions ??= {})
  const args = (launchOptions.args ??= [])
  for (const arg of CHROMIUM_LAUNCH_ARGS) if (!args.includes(arg)) args.push(arg)

  const configPath = path.join(app.getPath('userData'), 'playwright-mcp.config.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  return configPath
}

export function resolvePlaywrightMcpCommand(args: string[]): {
  command: string
  args: string[]
  env: Record<string, string>
} {
  const cliPath = path.join(getNodeModulesRoot(), '@playwright', 'mcp', 'cli.js')
  // Older or hand-edited configs may lack --isolated, so enforce it at spawn time.
  const mcpArgs = args.slice(1)
  if (!mcpArgs.includes('--isolated')) mcpArgs.push('--isolated')

  // Dropped here because writeMcpConfig merges its content into ours instead.
  const configIndex = mcpArgs.indexOf('--config')
  const userConfigPath = configIndex === -1 ? undefined : mcpArgs[configIndex + 1]
  if (configIndex !== -1) mcpArgs.splice(configIndex, userConfigPath ? 2 : 1)

  return {
    command: findNode(),
    args: [cliPath, ...mcpArgs],
    env: {
      PLAYWRIGHT_BROWSERS_PATH: getPlaywrightBrowsersPath(),
      ELECTRON_RUN_AS_NODE: '1',
      PLAYWRIGHT_MCP_CONFIG: writeMcpConfig(userConfigPath),
    },
  }
}

const ELEVATED_BROWSERS = new Set(['chrome', 'msedge'])

// chrome/msedge are "channel" installs that use the system browser, 
// so detect them by known install path instead of the PLAYWRIGHT_BROWSERS_PATH scan below.
function getSystemBrowserCandidates(browser: string): string[] {
  const home = app.getPath('home')
  if (process.platform === 'darwin') {
    return browser === 'chrome'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
  }
  if (process.platform === 'linux') {
    return browser === 'chrome'
      ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/google-chrome']
      : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge']
  }
  // win32
  const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], path.join(home, 'AppData', 'Local')]
    .filter((p): p is string => !!p)
  return browser === 'chrome'
    ? roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : roots.map((r) => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
}

export function isBrowserInstalled(browser: string): boolean {
  if (ELEVATED_BROWSERS.has(browser)) {
    return getSystemBrowserCandidates(browser).some((p) => fs.existsSync(p))
  }
  const browsersPath = getPlaywrightBrowsersPath()
  try {
    return fs.readdirSync(browsersPath).some((d) => d.startsWith(browser))
  } catch {
    return false
  }
}

export function installBrowser(
  browser: string,
  onOutput: (line: string) => void,
  sudoPassword?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cliPath = getPlaywrightCliPath()
    const node = findNode()
    const needsElevation = ELEVATED_BROWSERS.has(browser)

    let command: string
    let args: string[]
    let stdinData: string | undefined

    if (needsElevation && sudoPassword && process.platform !== 'win32') {
      // sudo -S pipes the password; -E preserves ELECTRON_RUN_AS_NODE/PLAYWRIGHT_BROWSERS_PATH.
      // Also chown browsersPath back afterward, since root can leave shared deps (e.g. ffmpeg)
      // root-owned and block later non-elevated installs — done in the same sudo session so the
      // password is only prompted once, and after the install regardless of its exit code.
      const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
      const installCmd = [node, cliPath, 'install', '--force', browser].map(shQuote).join(' ')
      const chownCmd = `chown -R ${process.getuid!()}:${process.getgid!()} ${shQuote(getPlaywrightBrowsersPath())}`
      command = 'sudo'
      args = ['-S', '-E', 'sh', '-c', `${installCmd}; ec=$?; ${chownCmd}; exit $ec`]
      stdinData = sudoPassword + '\n'
    } else {
      command = node
      args = [cliPath, 'install', '--force', browser]
    }

    const proc = spawn(command, args, {
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: getPlaywrightBrowsersPath(),
        ELECTRON_RUN_AS_NODE: '1',
      },
    })
    if (stdinData) {
      proc.stdin.write(stdinData)
      proc.stdin.end()
    }
    proc.stdout.on('data', (d: Buffer) => onOutput(d.toString()))
    proc.stderr.on('data', (d: Buffer) => onOutput(d.toString()))
    proc.on('close', (code: number | null) => {
      if (code === 0) resolve()
      else reject(new Error(`playwright install ${browser} exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}
