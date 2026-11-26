export interface FoldableStates {
  folded: number
  unfolded: number
}

export function isDeviceStateId(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id <= 10000
}

const endpointNames = {
  folded: new Set(['CLOSED', 'FOLDED'])
, unfolded: new Set(['OPEN', 'OPENED', 'UNFOLDED'])
}
const otherPostureNames = new Set([
  'HALF', 'TENT', 'REAR', 'DUAL', 'CONCURRENT', 'EXTERNAL', 'FLIPPED', 'EMULATED'
])
const stateRecord = /^\s*DeviceState\{identifier=(\d+), name='([^']+)'(?:,[^{}]*)?\},?\s*$/

function parseSupportedStates(output: string) {
  let lines = output.trim().split(/\r?\n/)
  if (lines[0] === 'Supported states: [') {
    if (lines.at(-1) !== ']') {
      return null
    }
    lines = lines.slice(1, -1)
  }

  const states = new Map<number, string>()
  for (const line of lines) {
    const match = stateRecord.exec(line)
    const id = Number(match?.[1])
    const name = match?.[2]?.trim().toUpperCase()
    if (!isDeviceStateId(id) || !name || states.has(id)) {
      return null
    }
    states.set(id, name)
  }
  return states
}

function parseResourceIds(output: string, resource: 'folded' | 'open') {
  const value = output.trim()
  const missing = `Error: failed to get the resource android:array/config_${resource}DeviceStates`
  // An empty framework array or a missing resource is common on newer builds.
  if (!value || value === missing) {
    return []
  }
  const values = value.split(/\r?\n/).map(line => line.trim())
  const ids = values.map(Number)
  return values.every(line => /^\d+$/.test(line)) && ids.every(isDeviceStateId) ? ids : null
}

function findEndpoint(
  states: Map<number, string>, ids: number[], endpoint: keyof FoldableStates
): number | null {
  const opposite = endpoint === 'folded' ? 'unfolded' : 'folded'
  const named = [...states]
    .filter(([, name]) => endpointNames[endpoint].has(name))
    .map(([id]) => id)
  if (named.length > 1 || (ids.length && named.some(id => !ids.includes(id))) ||
      ids.some(id => endpointNames[opposite].has(states.get(id) ?? ''))) {
    return null
  }

  // Framework arrays can include intermediate states, such as TENT. A
  // canonical endpoint name can distinguish it from those other members.
  const id = named[0] ?? (ids.length === 1 ? ids[0] : null)
  if (typeof id !== 'number') {
    return null
  }
  const name = states.get(id)
  if (!name || name.split(/[^A-Z0-9]+/).some(part => otherPostureNames.has(part))) {
    return null
  }
  return id
}

export function parseFoldableStates(
  output: string, resources?: {folded: string, unfolded: string}
): FoldableStates | null {
  const states = parseSupportedStates(output)
  const foldedIds = parseResourceIds(resources?.folded ?? '', 'folded')
  const unfoldedIds = parseResourceIds(resources?.unfolded ?? '', 'open')
  if (!states || !foldedIds || !unfoldedIds ||
      foldedIds.some(id => !states.has(id) || unfoldedIds.includes(id)) ||
      unfoldedIds.some(id => !states.has(id))) {
    return null
  }

  const folded = findEndpoint(states, foldedIds, 'folded')
  const unfolded = findEndpoint(states, unfoldedIds, 'unfolded')
  return folded !== null && unfolded !== null && folded !== unfolded ? {folded, unfolded} : null
}
