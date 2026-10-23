import type { UpdateState } from './ipc-types'

export function updateLabel(state: UpdateState): string {
  switch (state.status) {
    case 'idle':
      return ''
    case 'disabled':
      return 'Manual updates only'
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return 'Up to date'
    case 'downloading':
      return `Downloading ${state.version ?? 'update'} · ${state.percent ?? 0}%`
    case 'downloaded':
      return `Version ${state.version} is ready`
    case 'error':
      return 'Update check failed'
  }
}

// The sidebar only shows an update that is on its way; checks and errors live in Config.
export function isUpdateIncoming(state: UpdateState): boolean {
  return state.status === 'downloading' || state.status === 'downloaded'
}
