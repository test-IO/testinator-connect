"use strict";
const electron = require("electron");
const IPC_TO_MAIN = {
  CONFIG_LOAD: "config:load",
  CONFIG_SAVE: "config:save",
  SERVICE_START: "service:start",
  SERVICE_STOP: "service:stop",
  SERVER_TEST: "server:test",
  SESSION_RESET: "session:reset",
  PLAYWRIGHT_INSTALL: "playwright:install",
  PLAYWRIGHT_CHECK: "playwright:check",
  CONFIG_OPEN_FILE: "config:open-file"
};
const IPC_TO_RENDERER = {
  LOG_ENTRY: "log:entry",
  STATUS_CHANGED: "status:changed",
  SESSION_UPDATED: "session:updated",
  SESSION_REMOVED: "session:removed",
  STATS_UPDATED: "stats:updated",
  TOOLS_UPDATED: "tools:updated",
  TOOL_CALL_UPDATED: "tool-call:updated",
  RESOURCES_UPDATED: "resources:updated",
  RESOURCE_READ_UPDATED: "resource-read:updated",
  PLAYWRIGHT_INSTALL_PROGRESS: "playwright:install-progress"
};
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // Renderer → Main
  loadConfig: () => electron.ipcRenderer.invoke(IPC_TO_MAIN.CONFIG_LOAD),
  saveConfig: (config) => electron.ipcRenderer.invoke(IPC_TO_MAIN.CONFIG_SAVE, config),
  startService: () => electron.ipcRenderer.invoke(IPC_TO_MAIN.SERVICE_START),
  stopService: () => electron.ipcRenderer.invoke(IPC_TO_MAIN.SERVICE_STOP),
  testServer: (name, conf) => electron.ipcRenderer.invoke(IPC_TO_MAIN.SERVER_TEST, name, conf),
  // Main → Renderer: event subscriptions
  onLogEntry: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.LOG_ENTRY, (_e, payload) => cb(payload));
  },
  onStatusChanged: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.STATUS_CHANGED, (_e, payload) => cb(payload));
  },
  onSessionUpdated: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.SESSION_UPDATED, (_e, payload) => cb(payload));
  },
  onSessionRemoved: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.SESSION_REMOVED, (_e, payload) => cb(payload));
  },
  onStatsUpdated: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.STATS_UPDATED, (_e, payload) => cb(payload));
  },
  onToolsUpdated: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.TOOLS_UPDATED, (_e, payload) => cb(payload));
  },
  onToolCallUpdated: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.TOOL_CALL_UPDATED, (_e, payload) => cb(payload));
  },
  onResourcesUpdated: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.RESOURCES_UPDATED, (_e, payload) => cb(payload));
  },
  onResourceReadUpdated: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.RESOURCE_READ_UPDATED, (_e, payload) => cb(payload));
  },
  resetSession: () => electron.ipcRenderer.invoke(IPC_TO_MAIN.SESSION_RESET),
  openConfigFile: () => electron.ipcRenderer.invoke(IPC_TO_MAIN.CONFIG_OPEN_FILE),
  checkPlaywrightBrowser: (browser) => electron.ipcRenderer.invoke(IPC_TO_MAIN.PLAYWRIGHT_CHECK, browser),
  installPlaywrightBrowser: (browser, sudoPassword) => electron.ipcRenderer.invoke(IPC_TO_MAIN.PLAYWRIGHT_INSTALL, browser, sudoPassword),
  onPlaywrightInstallProgress: (cb) => {
    electron.ipcRenderer.on(IPC_TO_RENDERER.PLAYWRIGHT_INSTALL_PROGRESS, (_e, line) => cb(line));
  }
});
