<script lang="ts">
  import { stats, tools } from '../lib/ipc.svelte'
</script>

<div class="stats-bar">
  <div class="stat">
    <span class="value">{tools.length}</span>
    <span class="label">Tools</span>
  </div>
  <div class="sep"></div>
  <div class="stat">
    <span class="value">{stats.activeSessions}</span>
    <span class="label">Active Sessions</span>
  </div>
  <div class="sep"></div>
  <div class="stat">
    <span class="value">{stats.totalCalls}</span>
    <span class="label">Total Calls</span>
  </div>
</div>

<style>
  .stats-bar {
    display: flex; align-items: center; gap: 0;
    padding: 8px 16px; background: #15151f;
    border-bottom: 1px solid #2d2d3d;
  }
  .stat { display: flex; align-items: baseline; gap: 6px; padding: 0 16px; }
  .stat:first-child { padding-left: 0; }
  .value { font-size: 18px; font-weight: 700; color: #e2e8f0; font-variant-numeric: tabular-nums; }
  .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .sep { width: 1px; height: 24px; background: #2d2d3d; }
</style>
