import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { isPlaywrightMcpCommand, resolvePlaywrightMcpCommand } from './playwright'
import { isNpxCommand, resolveNpxCommand } from './npx'

function getUvPath(): string {
  const base = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '../../resources')

  if (process.platform === 'darwin') {
    const binary = process.arch === 'arm64' ? 'uv-macos-arm64' : 'uv-macos-x64'
    return path.join(base, binary)
  }
  return path.join(base, 'uv-windows-x64.exe')
}

const PYTHON_COMMANDS = new Set(['python', 'python3', 'uv', 'uvx'])

// windows-mcp declares `requires-python >=3.14`, so uv would otherwise pick the
// newest interpreter available (3.15+). Its dependencies (e.g. pyyaml) ship no
// wheels for it yet and fall back to a source build, which fails on machines
// without the MSVC Build Tools. Pin to the newest interpreter with wheels.
const WINDOWS_MCP_PYTHON = '3.14'

function isWindowsMcpPackage(arg: string): boolean {
  return /^windows-mcp(?:$|[=<>~!@\[])/.test(arg)
}

function hasPythonFlag(args: string[]): boolean {
  return args.some((a) => a === '--python' || a === '-p' || a.startsWith('--python='))
}

// Insert `--python <version>` as a uv option (before the tool/command name).
// `insertAt` must be the index right after uv's `run` subcommand.
function pinWindowsMcpPython(args: string[], insertAt: number): string[] {
  if (!args.some(isWindowsMcpPackage) || hasPythonFlag(args)) return args
  return [...args.slice(0, insertAt), '--python', WINDOWS_MCP_PYTHON, ...args.slice(insertAt)]
}

export function resolveCommand(
  command: string,
  args: string[],
): { command: string; args: string[]; env?: Record<string, string> } {
  if (isPlaywrightMcpCommand(command, args)) {
    return resolvePlaywrightMcpCommand(args)
  }

  if (isNpxCommand(command)) {
    return resolveNpxCommand(args)
  }

  if (!PYTHON_COMMANDS.has(command)) {
    return { command, args }
  }

  const uvPath = getUvPath()

  if (!fs.existsSync(uvPath)) {
    return { command, args }
  }

  if (command === 'uv') {
    const runIdx = args.indexOf('run')
    return {
      command: uvPath,
      args: runIdx === -1 ? args : pinWindowsMcpPython(args, runIdx + 1),
    }
  }

  if (command === 'uvx') {
    return { command: uvPath, args: ['tool', 'run', ...pinWindowsMcpPython(args, 0)] }
  }

  return { command: uvPath, args: ['run', command, ...args] }
}
