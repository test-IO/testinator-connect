import { spawn } from 'child_process'
import * as path from 'path'
import type { ServerConfig } from '../../shared/ipc-types'

export const MAX_CHUNK_BYTES = 4 * 1024 * 1024

const READ_TIMEOUT_MS = 60_000
const MISSING_FILE_EXIT = 3
const UNREADABLE_FILE_EXIT = 4

const SSH_VALUE_OPTIONS = new Set('BbcDEeFIiJLlmOoPpQRSWw')

export interface FileChunk {
  data: string
  offset: number
  bytes: number
  eof: boolean
}

export function sshPrefix(conf: ServerConfig): string[] | null {
  if (!conf.command || path.basename(conf.command) !== 'ssh') return null
  const args = conf.args ?? []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') return i + 1 < args.length ? [conf.command, ...args.slice(0, i + 2)] : null
    if (!arg.startsWith('-') || arg === '-') return [conf.command, ...args.slice(0, i + 1)]

    for (let j = 1; j < arg.length; j++) {
      if (!SSH_VALUE_OPTIONS.has(arg[j])) continue
      if (j === arg.length - 1) i++
      break
    }
  }
  return null
}

export function readablePath(conf: ServerConfig, filePath: string): string {
  const roots = (conf.files?.roots ?? []).map((root) => root.replace(/\/+$/, '')).filter((root) => root.startsWith('/'))
  if (roots.length === 0) {
    throw new Error('file reads are not enabled for this server: its config has no files.roots')
  }
  if (!path.posix.isAbsolute(filePath) || path.posix.normalize(filePath) !== filePath) {
    throw new Error(`not an absolute, normalized path: ${filePath}`)
  }
  if (!roots.some((root) => filePath.startsWith(`${root}/`))) {
    throw new Error(`${filePath} is outside this server's files.roots`)
  }
  return filePath
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export async function readFileChunk(
  conf: ServerConfig,
  filePath: string,
  offset: number,
  length: number,
): Promise<FileChunk> {
  const prefix = sshPrefix(conf)
  if (!prefix) throw new Error('file reads need a server launched over ssh')

  const target = shellQuote(readablePath(conf, filePath))
  const start = Math.max(0, Math.floor(offset))
  const size = Math.min(Math.max(1, Math.floor(length)), MAX_CHUNK_BYTES)
  const remote =
    `test -f ${target} || exit ${MISSING_FILE_EXIT}; test -r ${target} || exit ${UNREADABLE_FILE_EXIT}; ` +
    `tail -c +${start + 1} ${target} | head -c ${size}`

  const [command, ...args] = prefix
  const data = await runForStdout(command, [...args, remote])
  if (data.length > size) throw new Error(`read returned ${data.length} bytes, more than the ${size} asked for`)

  return { data: data.toString('base64'), offset: start, bytes: data.length, eof: data.length < size }
}

function runForStdout(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), READ_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === MISSING_FILE_EXIT) return reject(new Error('no such file'))
      if (code === UNREADABLE_FILE_EXIT) return reject(new Error('file is not readable'))
      if (code !== 0) return reject(new Error(`read failed (${signal ?? `exit ${code}`}): ${stderr.trim()}`))
      resolve(Buffer.concat(stdout))
    })
  })
}
