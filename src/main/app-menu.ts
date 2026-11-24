import { app, dialog, Menu } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'

export const APP_TITLE = 'Agentic QA - connect'

// Setting our own menu replaces Electron's default one, so the standard menus are
// rebuilt from their roles to keep copy/paste, reload and window shortcuts working.
export function buildMenuTemplate(platform: NodeJS.Platform, onAbout: () => void): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    // macOS only opens submenus from the menu bar, so the version sits one level down on every OS.
    { label: 'About', submenu: [{ label: `About ${APP_TITLE}`, click: onAbout }] },
  ]
}

export function installAppMenu(getWindow: () => BrowserWindow | null): void {
  const showAbout = (): void => {
    const options = {
      type: 'info' as const,
      title: `About ${APP_TITLE}`,
      message: APP_TITLE,
      detail: `Version ${app.getVersion()}`,
      buttons: ['OK'],
    }
    const win = getWindow()
    void (win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(process.platform, showAbout)))
}
