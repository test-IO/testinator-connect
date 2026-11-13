import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'connect-playwright-'))
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => userData } }))

import { resolvePlaywrightMcpCommand } from '../../src/main/playwright'

describe('resolvePlaywrightMcpCommand', () => {
  it('adds --isolated and --ignore-https-errors when the config lacks them', () => {
    const { args } = resolvePlaywrightMcpCommand(['@playwright/mcp@latest', '--headless'])

    expect(args.slice(1)).toEqual(['--headless', '--isolated', '--ignore-https-errors'])
  })

  it('does not duplicate flags the config already has', () => {
    const { args } = resolvePlaywrightMcpCommand(['@playwright/mcp@latest', '--ignore-https-errors', '--isolated'])

    expect(args.filter((a) => a === '--ignore-https-errors')).toHaveLength(1)
    expect(args.filter((a) => a === '--isolated')).toHaveLength(1)
  })

  it('drops --ignore-https-errors when the setting is off', () => {
    const { args } = resolvePlaywrightMcpCommand(['@playwright/mcp@latest', '--ignore-https-errors'], false)

    expect(args.slice(1)).toEqual(['--isolated'])
  })
})
