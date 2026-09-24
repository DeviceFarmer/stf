import type {DeviceState} from '@/core/devices/types'

export const stateColors: Record<DeviceState, string> = {
  using: 'blue'
  , automation: 'cyan'
  , busy: 'orange'
  , available: 'green'
  , ready: 'teal'
  , present: 'gray'
  , preparing: 'yellow'
  , unauthorized: 'red'
  , offline: 'orange'
  , absent: 'gray'
}

export function stateColor(state: string): string {
  return stateColors[state as DeviceState] || 'gray'
}

const classedStates = new Set([
  'using'
  , 'busy'
  , 'available'
  , 'ready'
  , 'present'
  , 'preparing'
  , 'unauthorized'
  , 'offline'
  , 'automation'
])

export function stateClass(state: string): string {
  return classedStates.has(state) ? `state-${state}` : ''
}
