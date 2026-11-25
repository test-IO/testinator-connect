import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, dialog: {}, Menu: {} }))

import { buildMenuTemplate } from '../../src/main/app-menu'

describe('buildMenuTemplate', () => {
  it('keeps the standard macOS menus and adds About after Window', () => {
    const template = buildMenuTemplate('darwin', () => {})

    expect(template.map((item) => item.role ?? item.label)).toEqual([
      'appMenu',
      'fileMenu',
      'editMenu',
      'viewMenu',
      'windowMenu',
      'About',
    ])
  })

  it('has no app menu on Windows', () => {
    const template = buildMenuTemplate('win32', () => {})

    expect(template.map((item) => item.role ?? item.label)).toEqual([
      'fileMenu',
      'editMenu',
      'viewMenu',
      'windowMenu',
      'About',
    ])
  })

  it('opens the About dialog from the item inside the About menu', () => {
    const onAbout = vi.fn()
    const about = buildMenuTemplate('win32', onAbout).at(-1)
    const [item] = about?.submenu as Electron.MenuItemConstructorOptions[]

    expect(item.label).toBe('About Agentic QA - connect')
    item.click?.({} as never, undefined, {} as never)
    expect(onAbout).toHaveBeenCalledOnce()
  })
})
