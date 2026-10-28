import type { UpdateState } from '../../shared/ipc-types'

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

export const INITIAL_UPDATE_STATE: UpdateState = { status: 'idle' }

const MAX_MESSAGE_LENGTH = 160

export function reduceUpdateState(state: UpdateState, event: UpdaterEvent): UpdateState {
  // A downloaded update stays installable whatever later background checks report.
  if (state.status === 'downloaded' && event.type !== 'downloaded') return state

  switch (event.type) {
    case 'checking':
      return { status: 'checking' }
    case 'available':
      return { status: 'downloading', version: event.version, percent: 0 }
    case 'not-available':
      return { status: 'up-to-date' }
    case 'progress':
      return { ...state, status: 'downloading', percent: Math.min(100, Math.max(0, Math.round(event.percent))) }
    case 'downloaded':
      return { status: 'downloaded', version: event.version }
    case 'error':
      return { status: 'error', message: shorten(event.message) }
  }
}

function shorten(message: string): string {
  const line = message.split('\n')[0].trim()
  return line.length > MAX_MESSAGE_LENGTH ? `${line.slice(0, MAX_MESSAGE_LENGTH - 3)}...` : line
}
