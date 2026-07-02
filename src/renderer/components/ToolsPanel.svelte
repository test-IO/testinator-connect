<script lang="ts">
  import { tools } from '../lib/ipc.svelte'

  let expanded = $state(new Set<string>())

  let grouped = $derived(
    tools.reduce((acc, tool) => {
      const list = acc.get(tool.server) ?? []
      list.push(tool)
      acc.set(tool.server, list)
      return acc
    }, new Map<string, typeof tools>()),
  )

  function toggle(key: string): void {
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expanded = next
  }
</script>

<div class="tools-panel">
  <div class="header">
    <span>Available Tools</span>
    <span class="count">{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="body">
    {#if tools.length === 0}
      <div class="empty">No tools discovered yet. Start the service to discover tools.</div>
    {:else}
      {#each [...grouped.entries()] as [server, serverTools]}
        <div class="server-group">
          <div class="server-header">
            <span class="server-name">{server}</span>
            <span class="server-count">{serverTools.length}</span>
          </div>
          {#each serverTools as tool}
            {@const key = `${server}.${tool.name}`}
            {@const isOpen = expanded.has(key)}
            <div class="tool" class:open={isOpen}>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div class="tool-row" onclick={() => toggle(key)}>
                <span class="chevron">{isOpen ? '▾' : '▸'}</span>
                <span class="tool-name">{tool.name}</span>
                {#if tool.description}
                  <span class="tool-desc">{tool.description}</span>
                {/if}
              </div>
              {#if isOpen}
                <div class="tool-detail">
                  {#if tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0}
                    <div class="params-label">Parameters</div>
                    {#each Object.entries(tool.inputSchema.properties) as [propName, propDef]}
                      {@const def = propDef as Record<string, unknown>}
                      {@const required = tool.inputSchema.required?.includes(propName)}
                      <div class="param">
                        <span class="param-name">{propName}</span>
                        {#if required}<span class="param-required">required</span>{/if}
                        <span class="param-type">{String(def.type ?? 'any')}</span>
                        {#if def.description}
                          <span class="param-desc">{String(def.description)}</span>
                        {/if}
                      </div>
                    {/each}
                  {:else}
                    <div class="params-label">No parameters</div>
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
  .tools-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; width: 100%; }

  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; font-size: 11px; font-weight: 700;
    color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em;
    border-bottom: 1px solid #2d2d3d; flex-shrink: 0;
  }
  .count { font-size: 10px; background: #1e2a45; color: #60a5fa; padding: 1px 6px; border-radius: 10px; text-transform: none; letter-spacing: 0; }

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

  .tool { border-top: 1px solid #1a1a28; }
  .tool-row {
    display: flex; align-items: baseline; gap: 8px;
    padding: 7px 12px; cursor: pointer;
    transition: background 0.1s;
  }
  .tool-row:hover { background: #1a1a28; }
  .tool.open .tool-row { background: #131320; }

  .chevron { font-size: 10px; color: #4b5563; flex-shrink: 0; width: 10px; }
  .tool-name { font-size: 13px; color: #e2e8f0; font-weight: 500; flex-shrink: 0; }
  .tool-desc { font-size: 11px; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }

  .tool-detail { padding: 8px 12px 10px 30px; background: #0d0d16; border-top: 1px solid #1a1a28; }

  .params-label { font-size: 10px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }

  .param { display: flex; align-items: baseline; gap: 6px; padding: 3px 0; font-size: 12px; }
  .param-name { color: #60a5fa; font-family: monospace; }
  .param-required { font-size: 9px; color: #f59e0b; background: rgba(245,158,11,0.1); padding: 1px 4px; border-radius: 3px; }
  .param-type { font-size: 11px; color: #374151; font-family: monospace; }
  .param-desc { font-size: 11px; color: #4b5563; flex: 1; }
</style>
