<script lang="ts">
  import { onMount } from 'svelte'
  import type { AppConfig, ServerConfig } from '../../shared/ipc-types'
  import { KNOWN_INTEGRATIONS } from '../../shared/known-integrations'

  type TestResult = { ok: boolean; toolCount: number; error?: string }
  type ServerEntry = { name: string; conf: ServerConfig; testing?: boolean; testResult?: TestResult | null }

  let view: 'cards' | 'json' = $state('cards')
  let platform = $state('')

  // ── cards state ─────────────────────────────────────────────────────────────
  let servers: ServerEntry[] = $state([])
  let saving = $state(false)
  let saved = $state(false)
  let saveError = $state('')
  let savedConfig: AppConfig | null = null

  // ── json editor state ────────────────────────────────────────────────────────
  let jsonText = $state('')
  let parseError = $state('')
  let jsonSaving = $state(false)
  let jsonSaved = $state(false)

  onMount(async () => {
    platform = await window.electronAPI.getPlatform()
    savedConfig = await window.electronAPI.loadConfig()
    loadCards(savedConfig)
  })

  function loadCards(config: AppConfig | null) {
    if (config) {
      servers = Object.entries(config.servers ?? {}).map(([name, conf]) => ({ name, conf: { ...conf } }))
    } else {
      servers = [defaultServer()]
    }
  }

  async function switchToJson() {
    // always reload from disk so editor reflects latest saved state
    savedConfig = await window.electronAPI.loadConfig()
    jsonText = JSON.stringify(savedConfig?.servers ?? {}, null, 2)
    parseError = ''
    view = 'json'
  }

  function switchToCards() {
    view = 'cards'
  }

  // ── cards actions ────────────────────────────────────────────────────────────

  function defaultServer(): ServerEntry {
    return { name: 'MyServer', conf: { type: 'stdio', command: '', args: [], stateful: false } }
  }

  function addServer() { servers.push(defaultServer()) }
  function removeServer(i: number) { servers.splice(i, 1) }

  // Unlike addServer(), this pushes a server whose name is the driver id.
  // That name is the platform's only signal for the driver, so the name
  // field locks once it matches one (see isKnownIntegrationName).
  function addKnownIntegration(select: HTMLSelectElement) {
    const integration = KNOWN_INTEGRATIONS.find((k) => k.id === select.value)
    select.value = ''
    if (!integration) return
    servers.push({
      name: integration.defaultServerName,
      conf: { ...integration.conf, args: [...(integration.conf.args ?? [])] },
    })
  }

  function knownIntegrationLabel(name: string): string | undefined {
    return KNOWN_INTEGRATIONS.find((k) => k.id === name)?.label
  }

  // The name field locks (it's not just badged) once it matches a known
  // integration id. The platform identifies a driver by server name alone,
  // so letting the name drift would silently disconnect it from the driver.
  function isKnownIntegrationName(name: string): boolean {
    return KNOWN_INTEGRATIONS.some((k) => k.id === name)
  }

  async function testServer(i: number) {
    const entry = servers[i]
    entry.testing = true
    entry.testResult = null
    try {
      const raw = $state.snapshot(entry) as ServerEntry
      entry.testResult = await window.electronAPI.testServer(raw.name || 'test', raw.conf)
    } catch (e) {
      entry.testResult = { ok: false, toolCount: 0, error: e instanceof Error ? e.message : String(e) }
    } finally {
      entry.testing = false
    }
  }

  function getArgsString(entry: ServerEntry): string { return (entry.conf.args ?? []).join(' ') }
  function setArgsString(entry: ServerEntry, value: string) { entry.conf.args = value ? value.split(/\s+/) : [] }
  function getHeadersString(entry: ServerEntry): string { return JSON.stringify(entry.conf.headers ?? {}, null, 2) }
  function setHeadersString(entry: ServerEntry, value: string) {
    try { entry.conf.headers = JSON.parse(value) } catch { /* keep old */ }
  }

  async function saveCards() {
    saving = true; saved = false; saveError = ''
    try {
      const rawServers = $state.snapshot(servers) as ServerEntry[]
      const serversObj: Record<string, ServerConfig> = {}
      for (const { name, conf } of rawServers) {
        if (name.trim()) serversObj[name.trim()] = conf
      }
      const config: AppConfig = { ...(savedConfig ?? { deployment_url: '' }), servers: serversObj }
      await window.electronAPI.saveConfig(config)
      savedConfig = config
      saved = true
      setTimeout(() => { saved = false }, 3000)
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  // ── json editor actions ──────────────────────────────────────────────────────

  async function saveJson() {
    parseError = ''
    let parsed: unknown
    try { parsed = JSON.parse(jsonText) } catch (e) {
      parseError = e instanceof Error ? e.message : String(e)
      return
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      parseError = 'Must be a JSON object'
      return
    }
    jsonSaving = true
    try {
      const config: AppConfig = { ...(savedConfig ?? { deployment_url: '' }), servers: parsed as Record<string, ServerConfig> }
      await window.electronAPI.saveConfig(config)
      savedConfig = config
      loadCards(config)
      jsonSaved = true
      setTimeout(() => { jsonSaved = false }, 3000)
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e)
    } finally {
      jsonSaving = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.target as HTMLTextAreaElement
      const start = el.selectionStart
      jsonText = jsonText.slice(0, start) + '  ' + jsonText.slice(el.selectionEnd)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 })
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      saveJson()
    }
  }
</script>

<div class="page">
  <!-- ── header ─────────────────────────────────────────────────────────────── -->
  <div class="page-header">
    <h1>MCP Servers</h1>
    <div class="header-actions">
      {#if view === 'cards'}
        <button class="json-btn" onclick={switchToJson}>Edit JSON</button>
        {#if platform === 'win32'}
          <select class="known-select"
            onchange={(e) => addKnownIntegration(e.target as HTMLSelectElement)}>
            <option value="">+ Add known integration</option>
            {#each KNOWN_INTEGRATIONS as integration (integration.id)}
              <option value={integration.id} title={integration.description}>{integration.label}</option>
            {/each}
          </select>
        {/if}
        <button class="add-btn" onclick={addServer}>+ Add Server</button>
        <button class="save-btn" onclick={saveCards} disabled={saving}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      {:else}
        <span class="json-hint">Cmd+S to save</span>
        <button class="back-btn" onclick={switchToCards}>← Cards</button>
        <button class="save-btn" onclick={saveJson} disabled={jsonSaving}>
          {jsonSaving ? 'Saving…' : jsonSaved ? '✓ Saved' : 'Save'}
        </button>
      {/if}
    </div>
  </div>

  <!-- ── cards view ─────────────────────────────────────────────────────────── -->
  {#if view === 'cards'}
    {#if saveError}
      <div class="banner error">{saveError}</div>
    {/if}
    <div class="server-list">
      {#each servers as entry, i (i)}
        <div class="server-card">
          <div class="server-header">
            <div class="field inline">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label>Name</label>
              <input type="text" bind:value={entry.name} placeholder="MyServer" class="server-name"
                disabled={isKnownIntegrationName(entry.name)}
                title={isKnownIntegrationName(entry.name) ? 'Fixed — the platform identifies this driver by this exact name.' : ''} />
            </div>
            <div class="field inline">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label>Type</label>
              <select bind:value={entry.conf.type}>
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
            </div>
            {#if knownIntegrationLabel(entry.name)}
              <span class="known-badge" title="Recognised integration — reported to Agentic QA as its driver.">
                {knownIntegrationLabel(entry.name)}
              </span>
            {/if}
            <label class="toggle" title="Stateful: keeps a persistent MCP connection alive per session.">
              <input type="checkbox" bind:checked={entry.conf.stateful} />
              <span class="track"></span>
              <span class="toggle-label">Stateful</span>
            </label>
            <button class="test-btn" disabled={entry.testing} onclick={() => testServer(i)}>
              {entry.testing ? '…' : 'Test'}
            </button>
            <button class="remove-btn" onclick={() => removeServer(i)}>✕</button>
          </div>

          {#if entry.testResult}
            <div class="test-result" class:ok={entry.testResult.ok} class:fail={!entry.testResult.ok}>
              {entry.testResult.ok
                ? `✓ ${entry.testResult.toolCount} tool${entry.testResult.toolCount !== 1 ? 's' : ''} found`
                : `✗ ${entry.testResult.error ?? 'Could not connect'}`}
            </div>
          {/if}

          {#if entry.conf.type === 'stdio'}
            <div class="field">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label>Command</label>
              <input type="text" bind:value={entry.conf.command} placeholder="npx or python" />
            </div>
            <div class="field">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label>Args <span class="hint">(space-separated)</span></label>
              <input type="text" value={getArgsString(entry)}
                oninput={(e) => setArgsString(entry, (e.target as HTMLInputElement).value)}
                placeholder="@playwright/mcp@latest --caps vision" class="mono" />
            </div>
          {:else}
            <div class="field">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label>URL</label>
              <input type="text" bind:value={entry.conf.url} placeholder="http://localhost:9586/mcp" />
            </div>
            <div class="field">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label>Headers <span class="hint">(JSON)</span></label>
              <textarea rows="3" value={getHeadersString(entry)}
                oninput={(e) => setHeadersString(entry, (e.target as HTMLTextAreaElement).value)}
                class="mono"></textarea>
            </div>
          {/if}
        </div>
      {/each}

      {#if servers.length === 0}
        <div class="empty">No servers configured. Click "+ Add Server" to add one.</div>
      {/if}
    </div>

  <!-- ── json editor view ───────────────────────────────────────────────────── -->
  {:else}
    <div class="editor-wrap">
      {#if parseError}
        <div class="banner error">{parseError}</div>
      {/if}
      <!-- svelte-ignore a11y_no_redundant_roles -->
      <textarea
        role="textbox"
        class="editor"
        class:has-error={!!parseError}
        bind:value={jsonText}
        onkeydown={handleKeydown}
        spellcheck={false}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
      ></textarea>
    </div>
  {/if}
</div>

<style>
  .page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .page-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 24px; border-bottom: 1px solid #2d2d3d; flex-shrink: 0;
  }
  h1 { font-size: 18px; font-weight: 700; color: #f1f5f9; margin: 0; }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  .json-hint { font-size: 11px; color: #4b5563; margin-right: 4px; }

  .json-btn, .back-btn {
    padding: 7px 14px; border-radius: 6px; border: 1px solid #374151;
    background: transparent; color: #6b7280; font-size: 12px; cursor: pointer; transition: all 0.12s;
  }
  .json-btn:hover, .back-btn:hover { border-color: #3b82f6; color: #60a5fa; }
  .add-btn {
    padding: 7px 14px; border-radius: 6px; border: 1px dashed #374151;
    background: transparent; color: #6b7280; font-size: 12px; cursor: pointer;
  }
  .add-btn:hover { border-color: #3b82f6; color: #3b82f6; }
  .known-select {
    padding: 7px 10px; border-radius: 6px; border: 1px dashed #374151;
    background: transparent; color: #6b7280; font-size: 12px; cursor: pointer;
  }
  .known-select:hover { border-color: #3b82f6; color: #3b82f6; }
  .save-btn {
    padding: 7px 20px; border-radius: 6px; border: none;
    background: #3b82f6; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .save-btn:not(:disabled):hover { background: #2563eb; }

  .banner { margin: 10px 24px 0; padding: 8px 12px; border-radius: 5px; font-size: 12px; font-family: monospace; }
  .banner.error { background: #3b1515; color: #f87171; }

  /* cards */
  .server-list { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
  .empty { padding: 40px; color: #4b5563; text-align: center; font-size: 13px; }
  .server-card {
    background: #15151f; border: 1px solid #2d2d3d; border-radius: 8px;
    padding: 14px; display: flex; flex-direction: column; gap: 10px;
  }
  .server-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .server-name { flex: 1; min-width: 120px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field.inline { flex-direction: row; align-items: center; gap: 8px; }
  label { font-size: 12px; color: #94a3b8; }
  .hint { color: #4b5563; font-weight: 400; }
  input[type="text"], select, textarea {
    background: #1e1e2e; border: 1px solid #374151; border-radius: 6px;
    padding: 8px 10px; color: #e2e8f0; font-size: 13px; outline: none; transition: border-color 0.15s;
  }
  input:focus, select:focus, textarea:focus { border-color: #3b82f6; }
  .mono { font-family: monospace; font-size: 12px; }
  textarea { resize: vertical; }
  .known-badge {
    padding: 3px 8px; border-radius: 10px; background: #1e293b;
    color: #60a5fa; font-size: 11px; font-weight: 600; white-space: nowrap;
  }
  .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  .toggle input { display: none; }
  .track {
    width: 32px; height: 18px; border-radius: 9px; background: #374151;
    position: relative; transition: background 0.15s; flex-shrink: 0;
  }
  .toggle input:checked ~ .track { background: #22c55e; }
  .track::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 0.15s;
  }
  .toggle input:checked ~ .track::after { transform: translateX(14px); }
  .toggle-label { font-size: 11px; color: #94a3b8; }
  .test-btn {
    padding: 4px 10px; border-radius: 4px; border: 1px solid #374151;
    background: transparent; color: #6b7280; font-size: 11px; font-weight: 600; cursor: pointer;
  }
  .test-btn:not(:disabled):hover { border-color: #3b82f6; color: #60a5fa; }
  .test-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .remove-btn {
    margin-left: auto; padding: 4px 8px; border-radius: 4px; border: none;
    background: transparent; color: #6b7280; font-size: 14px; cursor: pointer;
  }
  .remove-btn:hover { color: #ef4444; background: #2d1515; }
  .test-result { padding: 6px 10px; border-radius: 5px; font-size: 12px; font-family: monospace; }
  .test-result.ok { background: #14532d; color: #4ade80; }
  .test-result.fail { background: #3b1515; color: #f87171; word-break: break-word; }

  /* json editor */
  .editor-wrap { flex: 1; display: flex; flex-direction: column; padding: 16px 24px; overflow: hidden; }
  .editor {
    flex: 1; resize: none; width: 100%; box-sizing: border-box;
    background: #0a0a12; border: 1px solid #1e1e2e; border-radius: 6px;
    padding: 14px 16px; font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 12.5px; line-height: 1.6; color: #e2e8f0; outline: none;
    transition: border-color 0.15s;
  }
  .editor:focus { border-color: #3b82f6; }
  .editor.has-error { border-color: #ef4444; }
</style>
