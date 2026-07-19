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

export function resolvePlaywrightMcpCommand(args: string[]): {
  command: string
  args: string[]
  env: Record<string, string>
} {
  const cliPath = path.join(getNodeModulesRoot(), '@playwright', 'mcp', 'cli.js')
  return {
    command: findNode(),
    args: [cliPath, ...args.slice(1)],
    env: {
      PLAYWRIGHT_BROWSERS_PATH: getPlaywrightBrowsersPath(),
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}

export function isBrowserInstalled(browser: string): boolean {
  const browsersPath = getPlaywrightBrowsersPath()
  try {
    return fs.readdirSync(browsersPath).some((d) => d.startsWith(browser))
  } catch {
    return false
  }
}

const ELEVATED_BROWSERS = new Set(['chrome', 'msedge'])

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
      // pipe password to sudo -S so the install can acquire root when needed;
      // -E preserves ELECTRON_RUN_AS_NODE/PLAYWRIGHT_BROWSERS_PATH for the elevated process
      command = 'sudo'
      args = ['-S', '-E', node, cliPath, 'install', '--force', browser]
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
