import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir() } }))

import { closeAllClients, openPersistentSession } from '../../../src/main/service/mcp-client'

const fixture = join(__dirname, '../../fixtures/stdio-mcp-server.mjs')
const pidFile = join(tmpdir(), `connect-test-${process.pid}.pid`)

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntilGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    if (!isAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

afterEach(async () => {
  await closeAllClients()
  rmSync(pidFile, { force: true })
})

describe('closeAllClients', () => {
  it('stops a server process that is still open', async () => {
    await openPersistentSession({ command: process.execPath, args: [fixture, pidFile] })
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(isAlive(pid)).toBe(true)

    await closeAllClients()

    expect(await waitUntilGone(pid)).toBe(true)
  })

  it('does nothing when no server is open', async () => {
    await expect(closeAllClients()).resolves.toBeUndefined()
  })
})
