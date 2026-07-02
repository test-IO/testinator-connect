<script lang="ts">
  import { logs } from '../lib/ipc.svelte'
  import type { LogLevel } from '../../shared/ipc-types'

  let logEl: HTMLDivElement
  let autoScroll = $state(true)
  let expanded = $state(new Set<number>())

  const LEVEL_STYLE: Record<LogLevel, { color: string; prefix: string }> = {
    info:           { color: '#2563eb', prefix: 'ℹ' },
    success:        { color: '#22c55e', prefix: '✓' },
    warning:        { color: '#f59e0b', prefix: '⚠' },
    error:          { color: '#ef4444', prefix: '✗' },
    tool_call:      { color: '#06b6d4', prefix: '→' },
    tool_ok:        { color: '#22c55e', prefix: '✓' },
    tool_error:     { color: '#ef4444', prefix: '✗' },
    session:        { color: '#a855f7', prefix: '●' },
    resource_read:  { color: '#06b6d4', prefix: '⇒' },
    resource_ok:    { color: '#22c55e', prefix: '✓' },
    resource_error: { color: '#ef4444', prefix: '✗' },
  }

  const CHAR_THRESHOLD = 80

  $effect(() => {
    const _ = logs.length
    if (autoScroll && logEl) {
      logEl.scrollTop = logEl.scrollHeight
    }
  })

  function onScroll() {
    if (!logEl) return
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40
    autoScroll = atBottom
  }

  function clearLogs() {
    logs.splice(0, logs.length)
    expanded = new Set()
  }

  function toggle(i: number) {
    const next = new Set(expanded)
    if (next.has(i)) next.delete(i); else next.add(i)
    expanded = next
  }
</script>

<div class="activity">
  <div class="header">
    <span>Activity Log</span>
    <div class="controls">
      <label class="auto-scroll">
        <input type="checkbox" bind:checked={autoScroll} />
        auto-scroll
      </label>
      <button class="clear-btn" onclick={clearLogs}>Clear</button>
    </div>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="log-body" bind:this={logEl} onscroll={onScroll}>
    {#each logs as entry, i (entry.seq)}
      {@const style = LEVEL_STYLE[entry.level] ?? LEVEL_STYLE.info}
      {@const long = entry.message.length > CHAR_THRESHOLD}
      {@const open = expanded.has(i)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="entry {long ? 'expandable' : ''}" onclick={long ? () => toggle(i) : undefined}>
        <span class="ts">{entry.timestamp}</span>
        <span class="prefix" style="color: {style.color}">{style.prefix}</span>
        <span class="msg {open ? 'expanded' : ''}" style="color: {style.color}">{entry.message}</span>
        {#if entry.sessionId}
          <span class="sid">{entry.sessionId.slice(0, 8)}…</span>
        {/if}
        {#if long}
          <span class="chevron" style="color: {style.color}">{open ? '▲' : '▼'}</span>
        {/if}
      </div>
    {/each}
    {#if logs.length === 0}
      <div class="empty">Waiting for activity…</div>
    {/if}
  </div>
</div>

<style>
  .activity { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; font-size: 11px; font-weight: 700;
    color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em;
    border-bottom: 1px solid #2d2d3d; flex-shrink: 0;
  }
  .controls { display: flex; align-items: center; gap: 10px; }
  .auto-scroll { display: flex; align-items: center; gap: 4px; font-size: 10px; cursor: pointer; text-transform: none; color: #4b5563; }
  .clear-btn {
    padding: 2px 8px; border-radius: 4px; border: 1px solid #374151;
    background: transparent; color: #6b7280; font-size: 10px; cursor: pointer;
  }
  .clear-btn:hover { background: #1f2937; }
  .log-body { flex: 1; overflow-y: auto; padding: 4px 0; font-family: monospace; font-size: 12px; }
  .entry {
    display: flex; align-items: baseline; gap: 6px;
    padding: 2px 12px; line-height: 1.5;
  }
  .entry:hover { background: #1a1a28; }
  .expandable { cursor: pointer; }
  .ts { color: #4b5563; font-size: 11px; flex-shrink: 0; }
  .prefix { flex-shrink: 0; width: 14px; text-align: center; }
  .msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .msg.expanded { white-space: pre-wrap; word-break: break-word; overflow: visible; text-overflow: unset; }
  .chevron { flex-shrink: 0; font-size: 8px; opacity: 0.6; }
  .sid { color: #4b5563; font-size: 10px; flex-shrink: 0; }
  .empty { padding: 24px 12px; color: #4b5563; text-align: center; }
</style>
