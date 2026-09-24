import {v4 as uuidv4} from 'uuid'
import {createDeviceStore} from '@/core/device-store'
import type {Device} from '@/core/devices/types'

export interface ForwardRow {
  id: string
  devicePort: string
  targetHost: string
  targetPort: string
  enabled: boolean
  pending: boolean
}

type DeviceForward = NonNullable<Device['reverseForwards']>[number]

function defaults(id: string): ForwardRow {
  return {
    id
    , targetHost: 'localhost'
    , targetPort: '8080'
    , devicePort: '8080'
    , enabled: false
    , pending: false
  }
}

export const forwardRowsStore = createDeviceStore<ForwardRow[]>([defaults('_default')])

export function addForwardRow(serial: string) {
  forwardRowsStore.update(serial, (rows) => rows.concat(defaults(uuidv4())))
}

export function removeForwardRow(serial: string, id: string) {
  forwardRowsStore.update(serial, (rows) => rows.filter((row) => row.id !== id))
}

export function updateForwardRow(serial: string, id: string, patch: Partial<ForwardRow>) {
  forwardRowsStore.update(serial, (rows) => rows.map((row) => (row.id === id ? {...row, ...patch} : row)))
}

export function syncForwardRows(serial: string, forwards: DeviceForward[]) {
  const byId = new Map(forwards.map((forward) => [forward.id, forward]))
  forwardRowsStore.update(serial, (rows) => {
    const known = new Set(rows.map((row) => row.id))
    const synced = rows.map((row) => {
      const deviceForward = byId.get(row.id)
      if (row.pending) {
        return row
      }
      if (deviceForward) {
        return {...row, enabled: deviceForward.devicePort === Number(row.devicePort)}
      }
      return row.enabled ? {...row, enabled: false} : row
    })
    const added = forwards
      .filter((forward) => !known.has(forward.id))
      .map((forward) => ({
        id: forward.id
        , devicePort: String(forward.devicePort)
        , targetHost: forward.targetHost
        , targetPort: String(forward.targetPort)
        , enabled: true
        , pending: false
      }))
    return synced.concat(added)
  })
}
