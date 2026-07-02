<script lang="ts">
  import StatusBar from '../components/StatusBar.svelte'
  import StatsBar from '../components/StatsBar.svelte'
  import SessionsTable from '../components/SessionsTable.svelte'
  import ActivityLog from '../components/ActivityLog.svelte'
  import ToolsPanel from '../components/ToolsPanel.svelte'
  import ToolCallsPanel from '../components/ToolCallsPanel.svelte'
  import ResourcesPanel from '../components/ResourcesPanel.svelte'
  import { resetSession } from '../lib/ipc.svelte'

  type View = 'activity' | 'tools' | 'resources' | 'calls'
  let activeView: View = $state('activity')
  let resetting = $state(false)

  async function handleReset(): Promise<void> {
    resetting = true
    try {
      await resetSession()
    } finally {
      resetting = false
    }
  }
</script>

<div class="dashboard">
  <StatusBar />
  <StatsBar />
  <div class="tab-bar">
    <div class="tabs">
      <button class="tab" class:active={activeView === 'activity'} onclick={() => (activeView = 'activity')}>
        Activity
      </button>
      <button class="tab" class:active={activeView === 'tools'} onclick={() => (activeView = 'tools')}>
        Tools
      </button>
      <button class="tab" class:active={activeView === 'resources'} onclick={() => (activeView = 'resources')}>
        Resources
      </button>
      <button class="tab" class:active={activeView === 'calls'} onclick={() => (activeView = 'calls')}>
        Calls
      </button>
    </div>
    <button class="reset-btn" onclick={handleReset} disabled={resetting}>
      {resetting ? 'Resetting…' : 'Reset Session'}
    </button>
  </div>
  <div class="panes">
    {#if activeView === 'activity'}
      <div class="sessions-pane">
        <SessionsTable />
      </div>
      <div class="log-pane">
        <ActivityLog />
      </div>
    {:else if activeView === 'tools'}
      <ToolsPanel />
    {:else if activeView === 'resources'}
      <ResourcesPanel />
    {:else}
      <ToolCallsPanel />
    {/if}
  </div>
</div>

<style>
  .dashboard { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .tab-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; background: #0d0d16;
    border-bottom: 1px solid #2d2d3d; flex-shrink: 0; height: 36px;
  }
  .tabs { display: flex; gap: 2px; height: 100%; }
  .tab {
    padding: 0 14px; border: none; background: transparent;
    color: #4b5563; font-size: 12px; cursor: pointer;
    border-bottom: 2px solid transparent; transition: all 0.12s;
    height: 100%;
  }
  .tab:hover { color: #9ca3af; }
  .tab.active { color: #60a5fa; border-bottom-color: #3b82f6; }

  .reset-btn {
    padding: 4px 12px; border-radius: 5px;
    border: 1px solid #374151; background: transparent;
    color: #6b7280; font-size: 11px; cursor: pointer; transition: all 0.12s;
  }
  .reset-btn:hover:not(:disabled) { background: #1f2937; color: #d1d5db; border-color: #4b5563; }
  .reset-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .panes { display: flex; flex: 1; overflow: hidden; }
  .sessions-pane {
    width: 340px; flex-shrink: 0;
    border-right: 1px solid #2d2d3d;
    overflow-y: auto;
  }
  .log-pane { flex: 1; overflow: hidden; }
</style>
