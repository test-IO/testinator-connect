<script lang="ts">
  import { onMount } from 'svelte'
  import { initIpc, deepLinkPrefill } from './lib/ipc.svelte'
  import ConfigPage from './pages/ConfigPage.svelte'
  import DashboardPage from './pages/DashboardPage.svelte'
  import McpServersPage from './pages/McpServersPage.svelte'
  import appIcon from '../../images/macos/16x16.png'

  type Tab = 'dashboard' | 'config' | 'servers'
  let activeTab: Tab = $state('dashboard')

  onMount(() => {
    initIpc()
  })

  // A deep link always means "go configure the deployment URL" — jump to
  // the Config tab so the prefilled field/banner is immediately visible.
  $effect(() => {
    if (deepLinkPrefill.deploymentUrl !== null) activeTab = 'config'
  })
</script>

<div class="app">
  <!-- Draggable title bar — clears macOS traffic lights on the left -->
  <header class="titlebar">
    <div class="titlebar-brand">
      <img src={appIcon} alt="" class="brand-icon" />
      <span class="brand-name">Agentic QA</span>
      <span class="brand-sep">·</span>
      <span class="brand-product">connect</span>
    </div>
  </header>

  <div class="shell">
    <nav class="sidebar">
      <button
        class="nav-item"
        class:active={activeTab === 'dashboard'}
        onclick={() => (activeTab = 'dashboard')}
      >
        <span class="nav-icon">◈</span>
        Dashboard
      </button>
      <button
        class="nav-item"
        class:active={activeTab === 'servers'}
        onclick={() => (activeTab = 'servers')}
      >
        <span class="nav-icon">⬡</span>
        MCP Servers
      </button>
      <button
        class="nav-item"
        class:active={activeTab === 'config'}
        onclick={() => (activeTab = 'config')}
      >
        <span class="nav-icon">⚙</span>
        Config
      </button>
    </nav>

    <main class="content">
      {#if activeTab === 'dashboard'}
        <DashboardPage />
      {:else if activeTab === 'servers'}
        <McpServersPage />
      {:else}
        <ConfigPage />
      {/if}
    </main>
  </div>
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

  /* ── Title bar ─────────────────────────────────────────────────────────── */
  .titlebar {
    height: 42px;
    flex-shrink: 0;
    background: #0a0a12;
    border-bottom: 1px solid #1e1e2e;
    display: flex;
    align-items: center;
    /* Leave ~80px on the left for the macOS traffic lights */
    padding-left: 84px;
    -webkit-app-region: drag;
  }
  .titlebar-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    -webkit-app-region: no-drag; /* text is non-interactive but must not block clicks on traffic lights */
    pointer-events: none;
  }
  .brand-icon { width: 16px; height: 16px; object-fit: contain; }
  .brand-name { font-size: 13px; font-weight: 700; color: #e2e8f0; letter-spacing: -0.02em; }
  .brand-sep  { font-size: 12px; color: #374151; }
  .brand-product { font-size: 12px; font-weight: 500; color: #3b82f6; letter-spacing: 0.06em; text-transform: uppercase; }

  /* ── Shell (sidebar + content) ─────────────────────────────────────────── */
  .shell { display: flex; flex: 1; overflow: hidden; }

  .sidebar {
    width: 160px;
    flex-shrink: 0;
    background: #0d0d16;
    border-right: 1px solid #1e1e2e;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px 16px;
    -webkit-app-region: drag;
  }

  .nav-item {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 10px; border-radius: 6px; border: none;
    background: transparent; color: #6b7280; font-size: 13px;
    cursor: pointer; text-align: left; transition: all 0.12s;
    width: 100%;
    -webkit-app-region: no-drag;
  }
  .nav-item:hover { background: #1a1a28; color: #d1d5db; }
  .nav-item.active { background: #1e2a45; color: #60a5fa; font-weight: 600; }
  .nav-icon { font-size: 14px; opacity: 0.8; }

  .content { flex: 1; overflow: hidden; }
</style>
