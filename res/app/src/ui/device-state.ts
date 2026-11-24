import type {DeviceState} from '@/core/devices/types'

export const stateColors: Record<DeviceState, string> = {
  using: 'blue'
  , automation: 'violet'
  , busy: 'orange'
  , available: 'green'
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
  , 'present'
  , 'preparing'
  , 'unauthorized'
  , 'offline'
  , 'automation'
])

export function stateClass(state: string): string {
  return classedStates.has(state) ? `state-${state}` : ''
}
