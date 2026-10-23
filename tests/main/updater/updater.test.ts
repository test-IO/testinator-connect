import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fakeUpdater, fakeApp } = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    logger: null as unknown,
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  })
  return { fakeUpdater: updater, fakeApp: { isPackaged: true, getVersion: () => '0.1.0' } }
})

vi.mock('electron', () => ({ app: fakeApp }))
vi.mock('electron-updater', () => ({ autoUpdater: fakeUpdater }))

import { createUpdater } from '../../../src/main/updater/index'
import type { UpdaterDeps } from '../../../src/main/updater/index'

const realPlatform = process.platform

function setup(activeSessions = 0) {
  const send = vi.fn()
  const logger = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }
  const deps = {
    getWindow: () => ({ isDestroyed: () => false, webContents: { send } }),
    getActiveSessionCount: () => activeSessions,
    logger,
  } as unknown as UpdaterDeps
  return { updater: createUpdater(deps), send, logger }
}

beforeEach(() => {
  vi.useFakeTimers()
  // Windows enables the updater without a signing flag, so the tests don't depend on the host OS.
  Object.defineProperty(process, 'platform', { value: 'win32' })
  fakeApp.isPackaged = true
  fakeUpdater.removeAllListeners()
  fakeUpdater.checkForUpdates.mockClear()
  fakeUpdater.quitAndInstall.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', { value: realPlatform })
})

describe('createUpdater', () => {
  it('stays disabled and never checks in a development build', () => {
    fakeApp.isPackaged = false
    const { updater } = setup()
    expect(updater.getState()).toEqual({ status: 'disabled' })
    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks on launch and again every interval', () => {
    setup()
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(4 * 60 * 60 * 1000)
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('pushes each state change to the window', () => {
    const { updater, send } = setup()
    fakeUpdater.emit('update-available', { version: '0.2.0' })
    expect(updater.getState()).toMatchObject({ status: 'downloading', version: '0.2.0' })
    expect(send).toHaveBeenLastCalledWith('update:state', updater.getState())
  })

  it('logs "Up to date" only for a check the user started', async () => {
    const { updater, logger } = setup()
    fakeUpdater.emit('update-not-available')
    expect(logger.info).not.toHaveBeenCalled()

    await updater.checkNow(true)
    fakeUpdater.emit('update-not-available')
    expect(logger.info).toHaveBeenCalledWith('Up to date (0.1.0)')
  })

  it('keeps a downloaded update ready when a later check fails', () => {
    const { updater } = setup()
    fakeUpdater.emit('update-downloaded', { version: '0.2.0' })
    fakeUpdater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(updater.getState()).toMatchObject({ status: 'downloaded', version: '0.2.0' })
  })

  it('refuses to install before an update is downloaded', () => {
    const { updater } = setup()
    expect(updater.install()).toMatchObject({ ok: false })
    vi.runOnlyPendingTimers()
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('refuses to install while a test session is running', () => {
    const { updater } = setup(1)
    fakeUpdater.emit('update-downloaded', { version: '0.2.0' })
    expect(updater.install()).toMatchObject({ ok: false, reason: expect.stringContaining('1 test session is running') })
    vi.runOnlyPendingTimers()
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('installs silently and relaunches when idle', () => {
    const { updater } = setup()
    fakeUpdater.emit('update-downloaded', { version: '0.2.0' })
    expect(updater.install()).toEqual({ ok: true })
    vi.runOnlyPendingTimers()
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})
