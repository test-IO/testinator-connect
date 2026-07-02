import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { isPlaywrightMcpCommand, resolvePlaywrightMcpCommand } from './playwright'

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

const PYTHON_COMMANDS = new Set(['python', 'python3', 'uv'])

export function resolveCommand(
  command: string,
  args: string[],
): { command: string; args: string[]; env?: Record<string, string> } {
  if (isPlaywrightMcpCommand(command, args)) {
    return resolvePlaywrightMcpCommand(args)
  }

  if (!PYTHON_COMMANDS.has(command)) {
    return { command, args }
  }

  const uvPath = getUvPath()

  if (!fs.existsSync(uvPath)) {
    return { command, args }
  }

  if (command === 'uv') {
    return { command: uvPath, args }
  }

  return { command: uvPath, args: ['run', command, ...args] }
}
