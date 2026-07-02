<script lang="ts">
  import { sessions } from '../lib/ipc.svelte'
</script>

<div class="sessions">
  <div class="header">Sessions</div>
  {#if sessions.size === 0}
    <div class="empty">No sessions yet</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Session ID</th>
          <th>Servers</th>
          <th>Status</th>
          <th>Calls</th>
        </tr>
      </thead>
      <tbody>
        {#each [...sessions.values()] as session (session.sessionId)}
          <tr>
            <td class="mono">{session.sessionId.slice(0, 8)}…</td>
            <td>{session.servers.join(', ')}</td>
            <td>
              <span class="badge" class:active={session.status === 'active'}>
                {session.status}
              </span>
            </td>
            <td class="mono">{session.callCount}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .sessions { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .header {
    padding: 8px 12px; font-size: 11px; font-weight: 700;
    color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em;
    border-bottom: 1px solid #2d2d3d; flex-shrink: 0;
  }
  .empty { padding: 24px 12px; color: #4b5563; font-size: 13px; text-align: center; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th {
    padding: 6px 12px; text-align: left; font-size: 10px; font-weight: 600;
    color: #4b5563; text-transform: uppercase; letter-spacing: 0.06em;
    border-bottom: 1px solid #2d2d3d; background: #15151f; position: sticky; top: 0;
  }
  td { padding: 7px 12px; border-bottom: 1px solid #1e1e2e; color: #d1d5db; }
  tr:hover td { background: #1a1a28; }
  .mono { font-family: monospace; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 10px; font-weight: 600; background: #374151; color: #9ca3af;
  }
  .badge.active { background: #14532d; color: #4ade80; }
</style>
