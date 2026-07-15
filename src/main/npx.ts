import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { findNode, getNodeModulesRoot } from './playwright'

// Packaged builds bundle npm itself (see electron-builder.yml asarUnpack) so `npx`-based
// MCP servers don't depend on the end user having Node.js/npm installed system-wide.
function getNpxCliPath(): string {
  return path.join(getNodeModulesRoot(), 'npm', 'bin', 'npx-cli.js')
}

// npm's npx resolves child processes and installed packages' bin shebangs (`#!/usr/bin/env node`)
// via a `node` binary on PATH. Provide one backed by Electron's own runtime so nothing relies on
// a system Node install.
function ensureNodeShim(): string {
  const shimDir = path.join(app.getPath('userData'), 'node-shim')
  fs.mkdirSync(shimDir, { recursive: true })

  if (process.platform === 'win32') {
    const shimPath = path.join(shimDir, 'node.cmd')
    fs.writeFileSync(shimPath, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${findNode()}" %*\r\n`)
  } else {
    const shimPath = path.join(shimDir, 'node')
    fs.writeFileSync(shimPath, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${findNode()}" "$@"\n`, {
      mode: 0o755,
    })
  }
  return shimDir
}

export function isNpxCommand(command: string): boolean {
  return command === 'npx'
}

export function resolveNpxCommand(args: string[]): {
  command: string
  args: string[]
  env: Record<string, string>
} {
  const shimDir = ensureNodeShim()

  return {
    command: findNode(),
    args: [getNpxCliPath(), ...args],
    env: {
      PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`,
      ELECTRON_RUN_AS_NODE: '1',
      npm_config_cache: path.join(app.getPath('userData'), 'npm-cache'),
    },
  }
}
