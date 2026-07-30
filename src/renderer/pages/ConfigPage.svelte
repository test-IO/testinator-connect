<script lang="ts">
  import { onMount } from 'svelte'
  import type { AppConfig } from '../../shared/ipc-types'
  import { deepLinkPrefill } from '../lib/ipc.svelte'

  // ── connection state ─────────────────────────────────────────────────────────
  let deploymentUrl = $state('')
  let displayName = $state('')
  let timeout = $state(120)
  let sslVerify = $state(false)
  let savedAuthToken = $state('')

  let saving = $state(false)
  let saved = $state(false)
  let restartNotice = $state(false)
  let loadError = $state('')
  let saveError = $state('')
  let deepLinkApplied = $state(false)

  // ── playwright config state ──────────────────────────────────────────────────
  let pwBrowser = $state('chromium')
  let pwCaps = $state<string[]>(['vision'])
  let pwHeadless = $state(false)
  let pwDevice = $state('')
  let pwViewport = $state('1280x720')
  const pwIsolated = true

  let browserInstalled = $state<boolean | null>(null)
  let installing = $state(false)
  let installLog = $state('')
  let sudoPassword = $state('')

  const ELEVATED_BROWSERS = new Set(['chrome', 'msedge'])

  let savedConfig: AppConfig | null = null

  // ── devices list ─────────────────────────────────────────────────────────────
  const DEVICES: Record<string, string[]> = {
    'Desktop': [
      'Desktop Chrome', 'Desktop Chrome HiDPI',
      'Desktop Edge', 'Desktop Edge HiDPI',
      'Desktop Firefox', 'Desktop Firefox HiDPI',
      'Desktop Safari',
    ],
    'iPhone': [
      'iPhone 6', 'iPhone 6 landscape', 'iPhone 6 Plus', 'iPhone 6 Plus landscape',
      'iPhone 7', 'iPhone 7 landscape', 'iPhone 7 Plus', 'iPhone 7 Plus landscape',
      'iPhone 8', 'iPhone 8 landscape', 'iPhone 8 Plus', 'iPhone 8 Plus landscape',
      'iPhone SE', 'iPhone SE landscape', 'iPhone SE (3rd gen)', 'iPhone SE (3rd gen) landscape',
      'iPhone X', 'iPhone X landscape', 'iPhone XR', 'iPhone XR landscape',
      'iPhone 11', 'iPhone 11 landscape', 'iPhone 11 Pro', 'iPhone 11 Pro landscape',
      'iPhone 11 Pro Max', 'iPhone 11 Pro Max landscape',
      'iPhone 12', 'iPhone 12 landscape', 'iPhone 12 Pro', 'iPhone 12 Pro landscape',
      'iPhone 12 Pro Max', 'iPhone 12 Pro Max landscape', 'iPhone 12 Mini', 'iPhone 12 Mini landscape',
      'iPhone 13', 'iPhone 13 landscape', 'iPhone 13 Pro', 'iPhone 13 Pro landscape',
      'iPhone 13 Pro Max', 'iPhone 13 Pro Max landscape', 'iPhone 13 Mini', 'iPhone 13 Mini landscape',
      'iPhone 14', 'iPhone 14 landscape', 'iPhone 14 Plus', 'iPhone 14 Plus landscape',
      'iPhone 14 Pro', 'iPhone 14 Pro landscape', 'iPhone 14 Pro Max', 'iPhone 14 Pro Max landscape',
      'iPhone 15', 'iPhone 15 landscape', 'iPhone 15 Plus', 'iPhone 15 Plus landscape',
      'iPhone 15 Pro', 'iPhone 15 Pro landscape', 'iPhone 15 Pro Max', 'iPhone 15 Pro Max landscape',
      'iPhone 16', 'iPhone 16 landscape', 'iPhone 16 Plus', 'iPhone 16 Plus landscape',
      'iPhone 16 Pro', 'iPhone 16 Pro landscape', 'iPhone 16 Pro Max', 'iPhone 16 Pro Max landscape',
      'iPhone 16e', 'iPhone 16e landscape',
      'iPhone 17', 'iPhone 17 landscape', 'iPhone Air', 'iPhone Air landscape',
      'iPhone 17 Pro', 'iPhone 17 Pro landscape', 'iPhone 17 Pro Max', 'iPhone 17 Pro Max landscape',
      'iPhone 17e', 'iPhone 17e landscape',
    ],
    'iPad': [
      'iPad (gen 5)', 'iPad (gen 5) landscape', 'iPad (gen 6)', 'iPad (gen 6) landscape',
      'iPad (gen 7)', 'iPad (gen 7) landscape', 'iPad (gen 11)', 'iPad (gen 11) landscape',
      'iPad Mini', 'iPad Mini landscape', 'iPad Pro 11', 'iPad Pro 11 landscape',
    ],
    'Samsung Galaxy': [
      'Galaxy S5', 'Galaxy S5 landscape', 'Galaxy S8', 'Galaxy S8 landscape',
      'Galaxy S9+', 'Galaxy S9+ landscape', 'Galaxy S24', 'Galaxy S24 landscape',
      'Galaxy A55', 'Galaxy A55 landscape',
      'Galaxy Note 3', 'Galaxy Note 3 landscape', 'Galaxy Note II', 'Galaxy Note II landscape',
      'Galaxy S III', 'Galaxy S III landscape',
      'Galaxy Tab S4', 'Galaxy Tab S4 landscape', 'Galaxy Tab S9', 'Galaxy Tab S9 landscape',
      'Galaxy Z Fold 6', 'Galaxy Z Fold 6 landscape', 'Galaxy Z Fold 6 Cover', 'Galaxy Z Fold 6 Cover landscape',
      'Galaxy Z Fold 7', 'Galaxy Z Fold 7 landscape', 'Galaxy Z Fold 7 Cover', 'Galaxy Z Fold 7 Cover landscape',
      'Galaxy Z Flip 6', 'Galaxy Z Flip 6 landscape', 'Galaxy Z Flip 6 Cover', 'Galaxy Z Flip 6 Cover landscape',
      'Galaxy Z Flip 7', 'Galaxy Z Flip 7 landscape', 'Galaxy Z Flip 7 Cover', 'Galaxy Z Flip 7 Cover landscape',
    ],
    'Google Pixel / Nexus': [
      'Pixel 2', 'Pixel 2 landscape', 'Pixel 2 XL', 'Pixel 2 XL landscape',
      'Pixel 3', 'Pixel 3 landscape', 'Pixel 4', 'Pixel 4 landscape',
      'Pixel 4a (5G)', 'Pixel 4a (5G) landscape', 'Pixel 5', 'Pixel 5 landscape',
      'Pixel 6', 'Pixel 6 landscape', 'Pixel 6 Pro', 'Pixel 6 Pro landscape',
      'Pixel 6a', 'Pixel 6a landscape', 'Pixel 7', 'Pixel 7 landscape',
      'Pixel 7 Pro', 'Pixel 7 Pro landscape', 'Pixel 7a', 'Pixel 7a landscape',
      'Pixel 8', 'Pixel 8 landscape', 'Pixel 8 Pro', 'Pixel 8 Pro landscape',
      'Pixel 8a', 'Pixel 8a landscape', 'Pixel 9', 'Pixel 9 landscape',
      'Pixel 9 Pro', 'Pixel 9 Pro landscape', 'Pixel 9 Pro XL', 'Pixel 9 Pro XL landscape',
      'Pixel 10', 'Pixel 10 landscape', 'Pixel 10 Pro', 'Pixel 10 Pro landscape',
      'Pixel 10 Pro XL', 'Pixel 10 Pro XL landscape',
      'Nexus 4', 'Nexus 4 landscape', 'Nexus 5', 'Nexus 5 landscape',
      'Nexus 5X', 'Nexus 5X landscape', 'Nexus 6', 'Nexus 6 landscape',
      'Nexus 6P', 'Nexus 6P landscape', 'Nexus 7', 'Nexus 7 landscape',
      'Nexus 10', 'Nexus 10 landscape', 'Moto G4', 'Moto G4 landscape',
    ],
    'Other': [
      'Blackberry PlayBook', 'Blackberry PlayBook landscape',
      'BlackBerry Z30', 'BlackBerry Z30 landscape',
      'Kindle Fire HDX', 'Kindle Fire HDX landscape',
      'LG Optimus L70', 'LG Optimus L70 landscape',
      'Microsoft Lumia 550', 'Microsoft Lumia 550 landscape',
      'Microsoft Lumia 950', 'Microsoft Lumia 950 landscape',
      'Nokia Lumia 520', 'Nokia Lumia 520 landscape',
      'Nokia N9', 'Nokia N9 landscape',
    ],
  }

  // ── arg parsing / generation ─────────────────────────────────────────────────
  function parsePlaywrightArgs(args: string[]) {
    for (let i = 1; i < args.length; i++) {
      const a = args[i]
      if (a === '--browser' && args[i + 1])       { pwBrowser = args[++i]; continue }
      if (a === '--caps' && args[i + 1])           { pwCaps = args[++i].split(','); continue }
      if (a === '--headless')                      { pwHeadless = true; continue }
      if (a === '--device' && args[i + 1])         { pwDevice = args[++i]; continue }
      if (a === '--viewport-size' && args[i + 1])  { pwViewport = args[++i]; continue }
      if (a === '--isolated') continue
    }
  }

  function generatePlaywrightArgs(): string[] {
    const args = ['@playwright/mcp@latest']
    if (pwBrowser !== 'chromium')           args.push('--browser', pwBrowser)
    if (pwCaps.length > 0)                  args.push('--caps', pwCaps.join(','))
    if (pwHeadless)                         args.push('--headless')
    if (pwDevice)                           args.push('--device', pwDevice)
    else if (pwViewport !== '1280x720')     args.push('--viewport-size', pwViewport)
    args.push('--isolated')
    return args
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────
  let configLoaded = $state(false)

  onMount(async () => {
    try {
      savedConfig = await window.electronAPI.loadConfig()
      if (savedConfig) {
        deploymentUrl = savedConfig.deployment_url ?? ''
        displayName = savedConfig.display_name ?? ''
        timeout = savedConfig.timeout ?? 120
        sslVerify = savedConfig.ssl_verify ?? false
        savedAuthToken = savedConfig.auth_token ?? ''
        const pw = savedConfig.servers?.['Playwright_MCP']
        if (pw?.args) parsePlaywrightArgs(pw.args)
      }
    } catch (e) { loadError = String(e) }
    configLoaded = true
    await checkBrowser()
    window.electronAPI.onPlaywrightInstallProgress((line) => { installLog += line })
  })

  // Prefill (not auto-save) from a deep link — the user still reviews and
  // clicks Save, so an already-connected instance is never silently
  // redirected to a different deployment out from under them. Gated on
  // configLoaded so a deep link that arrives while the initial loadConfig()
  // is still in flight doesn't get clobbered once that load resolves.
  $effect(() => {
    if (deepLinkPrefill.deploymentUrl !== null && configLoaded) {
      deploymentUrl = deepLinkPrefill.deploymentUrl
      deepLinkPrefill.deploymentUrl = null
      // Quick connect already confirmed and stored these — mirror them into the
      // form so the page shows what the machine is actually configured with.
      if (deepLinkPrefill.authToken !== null) {
        savedAuthToken = deepLinkPrefill.authToken
        deepLinkPrefill.authToken = null
      }
      deepLinkApplied = true
      setTimeout(() => { deepLinkApplied = false }, 8000)
    }
  })

  $effect(() => {
    void pwBrowser
    sudoPassword = ''
    installLog = ''
    checkBrowser()
  })

  // ── save ─────────────────────────────────────────────────────────────────────
  async function save() {
    saving = true; saved = false; saveError = ''
    try {
      const existing = await window.electronAPI.loadConfig()
      const servers = { ...(existing?.servers ?? {}) }
      servers['Playwright_MCP'] = {
        type: 'stdio',
        command: 'npx',
        args: generatePlaywrightArgs(),
        stateful: true,
      }
      const config: AppConfig = {
        deployment_url: deploymentUrl,
        auth_token: savedAuthToken || undefined,
        timeout,
        ssl_verify: sslVerify,
        display_name: displayName || undefined,
        servers,
      }
      await window.electronAPI.saveConfig(config)
      savedConfig = config
      saved = true
      restartNotice = true
      setTimeout(() => { saved = false }, 3000)
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e)
    } finally { saving = false }
  }

  // ── browser install ──────────────────────────────────────────────────────────
  async function checkBrowser() {
    browserInstalled = await window.electronAPI.checkPlaywrightBrowser(pwBrowser)
  }

  async function installBrowser() {
    installing = true; installLog = ''
    try {
      await window.electronAPI.installPlaywrightBrowser(
        pwBrowser,
        ELEVATED_BROWSERS.has(pwBrowser) ? sudoPassword || undefined : undefined,
      )
      browserInstalled = true
    } catch (e) {
      installLog += `\nError: ${e instanceof Error ? e.message : String(e)}`
    } finally { installing = false }
  }

  function toggleCap(cap: string) {
    if (pwCaps.includes(cap)) pwCaps = pwCaps.filter(c => c !== cap)
    else pwCaps = [...pwCaps, cap]
  }
</script>

<div class="config-page">
  <div class="page-header">
    <h1>Configuration</h1>
    <button class="save-btn" onclick={save} disabled={saving}>
      {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
    </button>
  </div>

  {#if loadError}<div class="banner error">Failed to load config: {loadError}</div>{/if}
  {#if saveError}<div class="banner error">{saveError}</div>{/if}
  {#if deepLinkApplied}
    <div class="banner notice">
      Deployment URL prefilled from link. Review and click <strong>Save</strong> to apply.
    </div>
  {/if}
  {#if restartNotice}
    <div class="banner notice">
      Settings saved. <strong>Restart the service</strong> on the Dashboard for changes to take effect.
      <button class="dismiss-btn" onclick={() => restartNotice = false}>✕</button>
    </div>
  {/if}

  <div class="form">

    <!-- ── Connection ─────────────────────────────────────────────────────── -->
    <section>
      <h2>Connection</h2>
      <div class="field">
        <label for="deployment_url">Deployment URL <span class="req">*</span></label>
        <input id="deployment_url" type="text" bind:value={deploymentUrl} placeholder="http://localhost:8000" />
      </div>
      <div class="field">
        <label for="auth_token">Auth Token <span class="req">*</span></label>
        <input id="auth_token" type="text" bind:value={savedAuthToken} placeholder="Paste the token from workflow" autocomplete="off" spellcheck="false" />
        <span class="field-desc">Generate this in workflow under Settings → Agentic QA Connect for this machine, then paste it here. Required to connect.</span>
      </div>
      <div class="field">
        <label for="display_name">Display Name</label>
        <input id="display_name" type="text" bind:value={displayName} placeholder="My MacBook" />
        <span class="field-desc">Shown in the status bar and sent to the server to identify this device.</span>
      </div>
      <div class="row">
        <div class="field">
          <label for="timeout">Timeout <span class="hint">seconds</span></label>
          <input id="timeout" type="number" min="10" max="600" bind:value={timeout} />
          <span class="field-desc">How long to wait for a tool call to complete before giving up.</span>
        </div>
        <div class="field">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label>SSL Verify</label>
          <label class="toggle">
            <input type="checkbox" bind:checked={sslVerify} />
            <span class="track"></span>
            <span class="toggle-label">{sslVerify ? 'Enabled' : 'Disabled'}</span>
          </label>
          <span class="field-desc">Disable for self-signed certs on dev environments.</span>
        </div>
      </div>
    </section>

    <!-- ── Playwright MCP ─────────────────────────────────────────────────── -->
    <section>
      <h2>Playwright MCP</h2>
      <p class="section-desc">Configures the built-in Playwright MCP server (<code>Playwright_MCP</code>).</p>

      <!-- Browser -->
      <div class="pw-row">
        <div class="field" style="flex: 0 0 auto;">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label>Browser <span class="hint">--browser</span></label>
          <select bind:value={pwBrowser}>
            <option value="chromium">Chromium</option>
            <option value="chrome">Chrome</option>
            <option value="firefox">Firefox</option>
            <option value="webkit">WebKit (Safari)</option>
            <option value="msedge">Edge</option>
          </select>
        </div>
        {#if browserInstalled !== null}
          <span class="status-badge" class:ok={browserInstalled} class:fail={!browserInstalled}>
            {browserInstalled ? '✓ Installed' : '✗ Not installed'}
          </span>
        {/if}
        <button class="install-btn" onclick={installBrowser} disabled={installing}>
          {installing ? 'Installing…' : 'Install'}
        </button>
      </div>
      {#if ELEVATED_BROWSERS.has(pwBrowser)}
        <div class="field">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label>sudo Password <span class="hint">required to install system dependencies</span></label>
          <input type="password" bind:value={sudoPassword} placeholder="Enter your system password" autocomplete="off" />
        </div>
      {/if}
      {#if installLog}
        <pre class="install-log">{installLog}</pre>
      {/if}

      <!-- Capabilities -->
      <div class="field">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Capabilities <span class="hint">--caps</span></label>
        <div class="caps-row">
          {#each ['vision', 'pdf', 'config', 'network', 'storage', 'devtools', 'testing'] as cap}
            <button
              class="cap-chip"
              class:active={pwCaps.includes(cap)}
              onclick={() => toggleCap(cap)}
            >{cap}</button>
          {/each}
        </div>
        <span class="field-desc">
          <b>vision</b> — screenshots &amp; coordinate interactions ·
          <b>pdf</b> — PDF generation ·
          <b>config</b> — browser configuration ·
          <b>network</b> — request inspection &amp; mocking ·
          <b>storage</b> — cookies, localStorage, sessionStorage ·
          <b>devtools</b> — tracing &amp; DevTools ·
          <b>testing</b> — test assertions
        </span>
      </div>

      <!-- Headless -->
      <div class="field" style="max-width: 200px;">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Headless <span class="hint">--headless</span></label>
        <label class="toggle">
          <input type="checkbox" bind:checked={pwHeadless} />
          <span class="track"></span>
          <span class="toggle-label">{pwHeadless ? 'On' : 'Off'}</span>
        </label>
        <span class="field-desc">Run browser without a visible window.</span>
      </div>

      <!-- Device emulation -->
      <div class="field">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Emulate Device <span class="hint">--device</span></label>
        <select bind:value={pwDevice}>
          <option value="">None (use viewport)</option>
          {#each Object.entries(DEVICES) as [group, list]}
            <optgroup label={group}>
              {#each list as device}
                <option value={device}>{device}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </div>

      <!-- Viewport (hidden when device selected) -->
      {#if !pwDevice}
        <div class="field" style="max-width: 200px;">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label>Viewport Size <span class="hint">--viewport-size</span></label>
          <input type="text" bind:value={pwViewport} placeholder="1280x720" class="mono" />
        </div>
      {/if}

    </section>
  </div>
</div>

<style>
  .config-page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .page-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 24px; border-bottom: 1px solid #2d2d3d; flex-shrink: 0;
  }
  h1 { font-size: 18px; font-weight: 700; color: #f1f5f9; margin: 0; }
  .save-btn {
    padding: 7px 20px; border-radius: 6px; border: none;
    background: #3b82f6; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .save-btn:not(:disabled):hover { background: #2563eb; }

  .banner { margin: 10px 24px 0; padding: 10px 14px; border-radius: 6px; font-size: 13px; }
  .banner.error { background: #3b1515; color: #f87171; }
  .banner.notice { background: #1c2a1c; color: #86efac; display: flex; align-items: center; gap: 8px; }
  .banner.notice strong { color: #4ade80; }
  .dismiss-btn { margin-left: auto; background: none; border: none; color: #86efac; cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1; }
  .dismiss-btn:hover { color: #fff; }

  .form { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 32px; }
  section { display: flex; flex-direction: column; gap: 14px; }
  h2 { font-size: 13px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
  .section-desc { font-size: 12px; color: #4b5563; margin: 0; }
  .section-desc code { font-family: monospace; color: #6b7280; }

  .field { display: flex; flex-direction: column; gap: 5px; }
  label { font-size: 12px; color: #94a3b8; }
  .req { color: #ef4444; }
  .hint { color: #4b5563; font-weight: 400; font-size: 10px; letter-spacing: 0; text-transform: none; }
  .field-desc { font-size: 11px; color: #374151; line-height: 1.4; }
  .field-desc b { color: #4b5563; }

  input[type="text"], input[type="number"], select {
    background: #1e1e2e; border: 1px solid #374151; border-radius: 6px;
    padding: 8px 10px; color: #e2e8f0; font-size: 13px; outline: none; transition: border-color 0.15s;
  }
  input:focus, select:focus { border-color: #3b82f6; }
  .mono { font-family: monospace; font-size: 12px; }

  .row { display: flex; gap: 16px; flex-wrap: wrap; }
  .row .field { flex: 1; min-width: 160px; }

  .toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
  .toggle input { display: none; }
  .track {
    width: 36px; height: 20px; border-radius: 10px; background: #374151;
    position: relative; transition: background 0.15s; flex-shrink: 0;
  }
  .toggle input:checked ~ .track { background: #22c55e; }
  .track::after {
    content: ''; position: absolute; top: 3px; left: 3px;
    width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 0.15s;
  }
  .toggle input:checked ~ .track::after { transform: translateX(16px); }
  .toggle-label { font-size: 12px; color: #94a3b8; }

  /* playwright */
  .pw-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
  .status-badge { font-size: 12px; font-family: monospace; padding: 7px 10px; border-radius: 5px; flex-shrink: 0; white-space: nowrap; }
  .status-badge.ok { background: #14532d; color: #4ade80; }
  .status-badge.fail { background: #3b1515; color: #f87171; }
  .install-btn {
    padding: 8px 16px; border-radius: 5px; border: none;
    background: #3b82f6; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0;
  }
  .install-btn:not(:disabled):hover { background: #2563eb; }
  .install-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .install-log {
    background: #0a0a12; border: 1px solid #1e1e2e; border-radius: 5px;
    padding: 10px; font-family: monospace; font-size: 11px; color: #94a3b8;
    max-height: 160px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; margin: 0;
  }

  .caps-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .cap-chip {
    padding: 5px 14px; border-radius: 20px; border: 1px solid #374151;
    background: transparent; color: #6b7280; font-size: 12px; cursor: pointer;
    transition: all 0.12s; font-family: monospace;
  }
  .cap-chip:hover { border-color: #4b5563; color: #9ca3af; }
  .cap-chip.active { background: rgba(59,130,246,0.15); border-color: #3b82f6; color: #60a5fa; }
</style>
