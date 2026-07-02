<script lang="ts">
  import { toolCalls, resourceReads } from '../lib/ipc.svelte'

  let expanded = $state(new Set<string>())

  function toggle(id: string): void {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded = next
  }

  function formatResult(value: unknown): string {
    if (typeof value === 'string') return value
    return JSON.stringify(value, null, 2)
  }

  function sortKey(id: string): number {
    return parseInt(id.replace(/^r-/, ''))
  }

  const combined = $derived(
    [
      ...toolCalls.map((c) => ({ ...c, kind: 'tool' as const })),
      ...resourceReads.map((r) => ({ ...r, kind: 'resource' as const })),
    ].sort((a, b) => sortKey(b.id) - sortKey(a.id)),
  )

  const STATUS: Record<string, { color: string; icon: string }> = {
    pending: { color: '#f59e0b', icon: '⟳' },
    ok:      { color: '#22c55e', icon: '✓' },
    error:   { color: '#ef4444', icon: '✗' },
  }
</script>

<div class="calls-panel">
  <div class="header">
    <span>Calls</span>
    <span class="count">{combined.length} call{combined.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="body">
    {#if combined.length === 0}
      <div class="empty">No calls yet.</div>
    {:else}
      {#each combined as call (call.id)}
        {@const s = STATUS[call.status] ?? STATUS.pending}
        {@const isOpen = expanded.has(call.id)}
        <div class="call" class:open={isOpen}>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="call-row" onclick={() => toggle(call.id)}>
            <span class="chevron">{isOpen ? '▾' : '▸'}</span>
            <span class="status-icon" style="color: {s.color}">{s.icon}</span>
            <span class="ts">{call.timestamp}</span>
            {#if call.kind === 'tool'}
              <span class="kind-badge tool">tool</span>
              <span class="call-name">{call.server}<span class="dot">.</span>{call.tool}</span>
            {:else}
              <span class="kind-badge resource">resource</span>
              <span class="call-name">{call.server}<span class="dot"> </span><span class="uri">{call.uri}</span></span>
            {/if}
            {#if call.sessionId}
              <span class="sid">{call.sessionId.slice(0, 8)}…</span>
            {/if}
            <span class="spacer"></span>
            {#if call.durationMs !== undefined}
              <span class="duration">{call.durationMs}ms</span>
            {/if}
          </div>
          {#if isOpen}
            <div class="call-detail">
              {#if call.kind === 'tool'}
                <div class="section">
                  <div class="section-label">Arguments</div>
                  {#if call.args && Object.keys(call.args).length > 0}
                    <pre class="json">{JSON.stringify(call.args, null, 2)}</pre>
                  {:else}
                    <span class="none">none</span>
                  {/if}
                </div>
              {:else}
                <div class="section">
                  <div class="section-label">URI</div>
                  <span class="uri-detail">{call.uri}</span>
                </div>
              {/if}
              {#if call.status === 'ok'}
                <div class="section">
                  <div class="section-label ok">Result</div>
                  <pre class="json ok">{formatResult(call.result)}</pre>
                </div>
              {:else if call.status === 'error'}
                <div class="section">
                  <div class="section-label err">Error</div>
                  <pre class="json err">{call.error}</pre>
                </div>
              {:else}
                <div class="section">
                  <span class="pending-msg">⟳ In progress…</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .calls-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; width: 100%; }

  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; font-size: 11px; font-weight: 700;
    color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em;
    border-bottom: 1px solid #2d2d3d; flex-shrink: 0;
  }
  .count { font-size: 10px; background: #1e2a45; color: #60a5fa; padding: 1px 6px; border-radius: 10px; text-transform: none; letter-spacing: 0; }

  .body { flex: 1; overflow-y: auto; }

  .empty { padding: 32px 16px; color: #4b5563; text-align: center; font-size: 13px; }

  .call { border-bottom: 1px solid #1a1a28; }
  .call-row {
    display: flex; align-items: center; gap: 7px;
    padding: 7px 12px; cursor: pointer; transition: background 0.1s; font-size: 12px;
  }
  .call-row:hover { background: #1a1a28; }
  .call.open .call-row { background: #131320; }

  .chevron { font-size: 10px; color: #4b5563; flex-shrink: 0; width: 10px; }
  .status-icon { font-size: 13px; flex-shrink: 0; width: 14px; text-align: center; }
  .ts { color: #4b5563; font-size: 11px; flex-shrink: 0; font-family: monospace; }
  .kind-badge { font-size: 9px; padding: 1px 5px; border-radius: 4px; flex-shrink: 0; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .kind-badge.tool { color: #60a5fa; background: rgba(96,165,250,0.12); }
  .kind-badge.resource { color: #34d399; background: rgba(52,211,153,0.12); }
  .call-name { color: #e2e8f0; font-family: monospace; font-weight: 500; }
  .uri { color: #34d399; font-size: 11px; }
  .dot { color: #4b5563; }
  .sid { color: #4b5563; font-size: 10px; flex-shrink: 0; }
  .spacer { flex: 1; }
  .duration { color: #374151; font-size: 10px; font-family: monospace; flex-shrink: 0; }

  .call-detail { padding: 10px 12px 12px 34px; background: #0d0d16; border-top: 1px solid #1a1a28; display: flex; flex-direction: column; gap: 10px; }

  .section { display: flex; flex-direction: column; gap: 4px; }
  .section-label {
    font-size: 10px; font-weight: 700; color: #374151;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .section-label.ok { color: #166534; }
  .section-label.err { color: #7f1d1d; }

  pre.json {
    margin: 0; font-family: monospace; font-size: 11px; color: #94a3b8;
    background: #0a0a12; border: 1px solid #1e1e2e; border-radius: 4px;
    padding: 8px 10px; overflow-x: auto; white-space: pre-wrap; word-break: break-all;
    max-height: 200px; overflow-y: auto;
  }
  pre.json.ok { color: #86efac; border-color: #14532d; }
  pre.json.err { color: #fca5a5; border-color: #7f1d1d; }

  .none { font-size: 11px; color: #374151; font-style: italic; }
  .pending-msg { font-size: 12px; color: #f59e0b; }
  .uri-detail { font-size: 11px; color: #34d399; font-family: monospace; word-break: break-all; }
</style>
