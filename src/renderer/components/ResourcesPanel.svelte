<script lang="ts">
  import { resources } from '../lib/ipc.svelte'

  let expanded = $state(new Set<string>())

  let grouped = $derived(
    resources.reduce((acc, r) => {
      const list = acc.get(r.server) ?? []
      list.push(r)
      acc.set(r.server, list)
      return acc
    }, new Map<string, typeof resources>()),
  )

  function toggle(key: string): void {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expanded = next
  }
</script>

<div class="resources-panel">
  <div class="header">
    <span>Available Resources</span>
    <span class="count">{resources.length} resource{resources.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="body">
    {#if resources.length === 0}
      <div class="empty">No resources discovered. Start the service or the MCP servers may not expose resources.</div>
    {:else}
      {#each [...grouped.entries()] as [server, serverResources]}
        <div class="server-group">
          <div class="server-header">
            <span class="server-name">{server}</span>
            <span class="server-count">{serverResources.length}</span>
          </div>
          {#each serverResources as resource}
            {@const key = `${server}.${resource.uri}`}
            {@const isOpen = expanded.has(key)}
            <div class="resource" class:open={isOpen}>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div class="resource-row" onclick={() => toggle(key)}>
                <span class="chevron">{isOpen ? '▾' : '▸'}</span>
                <span class="resource-name">{resource.name}</span>
                {#if resource.mimeType}
                  <span class="mime-badge">{resource.mimeType}</span>
                {/if}
                {#if resource.description}
                  <span class="resource-desc">{resource.description}</span>
                {/if}
              </div>
              {#if isOpen}
                <div class="resource-detail">
                  <div class="uri-row">
                    <span class="detail-label">URI</span>
                    <span class="uri-value">{resource.uri}</span>
                  </div>
                  {#if resource.description}
                    <div class="desc-row">
                      <span class="detail-label">Description</span>
                      <span class="desc-value">{resource.description}</span>
                    </div>
                  {/if}
                  {#if resource.mimeType}
                    <div class="desc-row">
                      <span class="detail-label">MIME type</span>
                      <span class="desc-value">{resource.mimeType}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .resources-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; width: 100%; }

  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; font-size: 11px; font-weight: 700;
    color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em;
    border-bottom: 1px solid #2d2d3d; flex-shrink: 0;
  }
  .count { font-size: 10px; background: #1e2a38; color: #34d399; padding: 1px 6px; border-radius: 10px; text-transform: none; letter-spacing: 0; }

  .body { flex: 1; overflow-y: auto; }

  .empty { padding: 32px 16px; color: #4b5563; text-align: center; font-size: 13px; }

  .server-group { border-bottom: 1px solid #1e1e2e; }
  .server-header {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; background: #0d0d16;
    font-size: 11px; font-weight: 700; color: #4b5563;
    text-transform: uppercase; letter-spacing: 0.06em; position: sticky; top: 0; z-index: 1;
  }
  .server-name { color: #6b7280; }
  .server-count { font-size: 10px; background: #1a1a28; color: #4b5563; padding: 0 5px; border-radius: 8px; }

  .resource { border-top: 1px solid #1a1a28; }
  .resource-row {
    display: flex; align-items: baseline; gap: 8px;
    padding: 7px 12px; cursor: pointer;
    transition: background 0.1s;
  }
  .resource-row:hover { background: #1a1a28; }
  .resource.open .resource-row { background: #131320; }

  .chevron { font-size: 10px; color: #4b5563; flex-shrink: 0; width: 10px; }
  .resource-name { font-size: 13px; color: #e2e8f0; font-weight: 500; flex-shrink: 0; }
  .mime-badge { font-size: 9px; color: #34d399; background: rgba(52,211,153,0.1); padding: 1px 5px; border-radius: 4px; flex-shrink: 0; font-family: monospace; }
  .resource-desc { font-size: 11px; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }

  .resource-detail { padding: 8px 12px 10px 30px; background: #0d0d16; border-top: 1px solid #1a1a28; display: flex; flex-direction: column; gap: 6px; }

  .uri-row, .desc-row { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
  .detail-label { font-size: 10px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.06em; flex-shrink: 0; min-width: 72px; }
  .uri-value { color: #34d399; font-family: monospace; font-size: 11px; word-break: break-all; }
  .desc-value { color: #94a3b8; font-size: 11px; }
</style>
