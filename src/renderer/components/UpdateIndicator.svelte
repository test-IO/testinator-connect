<script lang="ts">
  import { update } from '../lib/ipc.svelte'
  import { isUpdateIncoming, updateLabel } from '../../shared/update-label'

  const INSTALL_NOTE_MS = 10_000

  let installNote: string | null = $state(null)
  let noteTimer: ReturnType<typeof setTimeout> | undefined

  async function install(): Promise<void> {
    const decision = await window.electronAPI.installUpdate()
    clearTimeout(noteTimer)
    installNote = decision.ok ? null : decision.reason
    // The refusal reason (e.g. a running session) goes stale, so the note fades out.
    if (installNote) noteTimer = setTimeout(() => (installNote = null), INSTALL_NOTE_MS)
  }
</script>

{#if isUpdateIncoming(update)}
  <div class="update" class:ready={update.status === 'downloaded'}>
    <span class="label">{updateLabel(update)}</span>

    {#if update.status === 'downloaded'}
      <button class="restart" onclick={install}>Restart to update</button>
      {#if installNote}<span class="note">{installNote}</span>{/if}
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
  .label { line-height: 1.3; }
  .note { color: #fcd34d; line-height: 1.3; }
  .restart {
    padding: 5px 8px; border-radius: 5px; border: none;
    background: #2563eb; color: #fff; font-size: 11px; font-weight: 600; cursor: pointer;
  }
  .restart:hover { background: #1d4ed8; }
</style>
