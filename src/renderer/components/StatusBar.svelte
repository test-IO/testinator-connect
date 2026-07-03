<script lang="ts">
  import { status, serviceError } from '../lib/ipc.svelte'

  let starting = $state(false)
  let stopping = $state(false)

  async function start() {
    starting = true
    serviceError.message = null
    try {
      await window.electronAPI.startService()
    } catch (e: unknown) {
      serviceError.message = e instanceof Error ? e.message : String(e)
    } finally {
      starting = false
    }
  }

  async function stop() {
    stopping = true
    try {
      await window.electronAPI.stopService()
    } finally {
      stopping = false
      starting = false   // also clears pending start if interrupted
    }
  }

  function copyId() {
    if (status.installationId) navigator.clipboard.writeText(status.installationId)
  }
</script>

<div class="status-bar">
  <div class="left">
    <span class="dot"
      class:connected={status.connected}
      class:connecting={!status.connected && (starting || status.connecting)}
    ></span>
    <div class="info">
      <div class="top-row">
        <span class="label">
          {#if status.connected}Connected
          {:else if starting || status.connecting}Connecting…
          {:else}Disconnected{/if}
        </span>
        {#if status.connected && status.isReconnect}
          <span class="badge reconnect">reconnected</span>
        {/if}
        {#if status.deploymentUrl}
          <span class="url">{status.deploymentUrl}</span>
        {/if}
      </div>
      {#if status.installationId}
        <div class="id-row">
          {#if status.displayName}
            <span class="display-name">{status.displayName}</span>
            <span class="id-sep">·</span>
          {/if}
          <span class="id-label">ID</span>
          <button class="id-value" onclick={copyId} title="Click to copy">
            {status.installationId}
          </button>
        </div>
      {/if}
    </div>
  </div>
  <div class="right">
    {#if status.connected}
      <button class="btn stop" disabled={stopping} onclick={stop}>
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
    {:else if starting || status.connecting}
      <span class="connecting-label">Connecting…</span>
      <button class="btn interrupt" onclick={stop}>Interrupt</button>
    {:else}
      <button class="btn start" onclick={start}>Start</button>
    {/if}
  </div>
</div>
{#if serviceError.message}
  <div class="error-bar">{serviceError.message}</div>
{/if}

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: #1a1a24;
    border-bottom: 1px solid #2d2d3d;
    gap: 12px;
  }
  .left { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #6b7280; flex-shrink: 0;
    box-shadow: 0 0 4px #6b7280;
  }
  .dot.connected { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
  .dot.connecting {
    background: #f59e0b;
    box-shadow: 0 0 6px #f59e0b;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .top-row { display: flex; align-items: center; gap: 8px; }
  .label { font-size: 13px; font-weight: 600; color: #e2e8f0; }
  .url { font-size: 12px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .badge {
    font-size: 10px; font-weight: 600; padding: 1px 6px;
    border-radius: 8px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .badge.reconnect { background: #1e3a5f; color: #60a5fa; }

  /* Installation ID row — this is what the workflow UI uses to identify this client */
  .id-row { display: flex; align-items: center; gap: 6px; }
  .display-name { font-size: 11px; color: #94a3b8; font-weight: 600; }
  .id-sep { font-size: 10px; color: #374151; }
  .id-label { font-size: 10px; color: #4b5563; text-transform: uppercase; letter-spacing: 0.06em; }
  .id-value {
    font-family: monospace; font-size: 11px; color: #a78bfa;
    background: transparent; border: none; cursor: pointer; padding: 0;
    letter-spacing: 0.05em;
  }
  .id-value:hover { color: #c4b5fd; text-decoration: underline; }

  .btn {
    padding: 5px 14px; border-radius: 5px; border: none;
    font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.start { background: #22c55e; color: #0f0f13; }
  .btn.stop { background: #ef4444; color: #fff; }
  .btn.interrupt { background: #f59e0b; color: #0f0f13; }
  .connecting-label { font-size: 12px; color: #f59e0b; font-weight: 500; }
  .error-bar {
    padding: 6px 16px; background: #3b1515; color: #f87171;
    font-size: 12px; border-bottom: 1px solid #5c1d1d;
  }
</style>
