import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import type { AppConfig } from '../shared/ipc-types'

export function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

// CLI mode's installation-id lives next to its --config file rather than in
// the GUI's userData dir, so a CLI-only install (e.g. a scheduled task with
// no GUI ever launched) still gets a stable id without touching userData.
//
// `pinnedId` (from AppConfig#installation_id) overrides both: provisioning
// tooling that already knows what id a machine must present (to match a
// pre-approval in workflow's admin panel, or to keep every clone of a golden
// VM image from racing to generate its own random id) wins outright, and
// nothing is written to a side file in that case.
export function getInstallationId(configPath?: string, pinnedId?: string): string {
  if (pinnedId) return pinnedId

  const idPath = configPath
    ? path.join(path.dirname(configPath), 'installation-id')
    : path.join(app.getPath('userData'), 'installation-id')
  if (fs.existsSync(idPath)) {
    const id = fs.readFileSync(idPath, 'utf8').trim()
    if (id.length === 16) return id
  }
  const id = randomBytes(8).toString('hex')
  fs.mkdirSync(path.dirname(idPath), { recursive: true })
  fs.writeFileSync(idPath, id, 'utf8')
  return id
}

export function loadConfig(overridePath?: string): AppConfig | null {
  const configPath = overridePath ?? getConfigPath()
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
      installation_id: raw.installation_id,
      servers,
    }
  } catch (e) {
    // Swallowed rather than thrown (GUI callers expect null → "no config
    // found" and render the empty Config page), but logged so a malformed
    // file doesn't look identical to a missing one — that distinction cost
    // real debugging time once already (CLI mode reporting "no config
    // found" for a config.json that in fact existed, just with a JSON
    // syntax error in it).
    console.error(`Failed to parse config at ${configPath}: ${e instanceof Error ? e.message : String(e)}`)
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
