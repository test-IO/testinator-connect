<script lang="ts">
  import { update } from '../lib/ipc.svelte'
  import { updateLabel } from '../../shared/update-label'

  let installNote: string | null = $state(null)

  async function install(): Promise<void> {
    const decision = await window.electronAPI.installUpdate()
    installNote = decision.ok ? null : decision.reason
  }

  function checkAgain(): void {
    installNote = null
    void window.electronAPI.checkForUpdates()
  }
</script>

{#if update.status !== 'idle'}
  <div class="update" class:ready={update.status === 'downloaded'} class:failed={update.status === 'error'}>
    <span class="label" title={update.message ?? ''}>{updateLabel(update)}</span>

    {#if update.status === 'downloaded'}
      <button class="restart" onclick={install}>Restart to update</button>
      {#if installNote}<span class="note">{installNote}</span>{/if}
    {:else if update.status === 'up-to-date' || update.status === 'error'}
      <button class="link" onclick={checkAgain}>Check again</button>
    {/if}
  </div>
{/if}

<style>
  .update {
    display: flex; flex-direction: column; gap: 4px;
    padding: 8px 10px; border-radius: 6px;
    background: #12121c; border: 1px solid #1e1e2e;
    font-size: 11px; color: #9ca3af;
    -webkit-app-region: no-drag;
  }
  .update.ready { border-color: #1e3a8a; color: #bfdbfe; }
  .update.failed { color: #fca5a5; }
  .label { line-height: 1.3; }
  .note { color: #fcd34d; line-height: 1.3; }
  .restart {
    padding: 5px 8px; border-radius: 5px; border: none;
    background: #2563eb; color: #fff; font-size: 11px; font-weight: 600; cursor: pointer;
  }
  .restart:hover { background: #1d4ed8; }
  .link {
    padding: 0; border: none; background: none; text-align: left;
    color: #60a5fa; font-size: 11px; cursor: pointer;
  }
</style>
