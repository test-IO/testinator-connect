import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import type { AppConfig } from '../shared/ipc-types'

export function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function getInstallationId(): string {
  const idPath = path.join(app.getPath('userData'), 'installation-id')
  if (fs.existsSync(idPath)) {
    const id = fs.readFileSync(idPath, 'utf8').trim()
    if (id.length === 16) return id
  }
  const id = randomBytes(8).toString('hex')
  fs.mkdirSync(path.dirname(idPath), { recursive: true })
  fs.writeFileSync(idPath, id, 'utf8')
  return id
}

export function loadConfig(): AppConfig | null {
  const configPath = getConfigPath()
  if (!fs.existsSync(configPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const servers: AppConfig['servers'] = {}
    for (const [name, conf] of Object.entries(raw.servers ?? {})) {
      servers[sanitizeServerName(name)] = conf as AppConfig['servers'][string]
    }
    return {
      deployment_url: raw.deployment_url ?? '',
      auth_token: raw.auth_token,
      timeout: Number(raw.timeout ?? 120),
      ssl_verify: raw.ssl_verify ?? false,
      display_name: raw.display_name,
      servers,
    }
  } catch {
    return null
  }
}

export function saveConfig(config: AppConfig): void {
  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

export function sanitizeServerName(name: string): string {
  let result = name.replace(/^[^a-zA-Z]+/, '')
  result = result.replace(/[^a-zA-Z0-9_]+$/, '')
  return result.replace(/[^a-zA-Z0-9_]/g, '_')
}
