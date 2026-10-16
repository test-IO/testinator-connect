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
