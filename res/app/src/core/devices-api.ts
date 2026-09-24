import {api} from './api'
import type {Device} from './devices/types'

export type TriState = 'Any' | 'True' | 'False' | string

export interface DeviceRemovalFilters {
  present: TriState
  booked: TriState
  annotated: TriState
  controlled: TriState
}

function removalQuery(filters: DeviceRemovalFilters): string {
  const parts: string[] = []
  const keys: Array<keyof DeviceRemovalFilters> = ['present', 'booked', 'annotated', 'controlled']
  for (const key of keys) {
    if (filters[key] !== 'Any') {
      parts.push(`${key}=${filters[key].toLowerCase()}`)
    }
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

export const devicesApi = {
  getDevices: (target: string, fields: string) =>
    api.get<{devices: Device[]}>(`/api/v1/devices?target=${target}&fields=${fields}`)
  , removeDevice: (serial: string, filters: DeviceRemovalFilters) =>
    api.delete(`/api/v1/devices/${serial}${removalQuery(filters)}`)
  , removeDevices: (filters: DeviceRemovalFilters, serials?: string[]) =>
    api.delete(`/api/v1/devices${removalQuery(filters)}`, serials ? {serials: serials.join()} : undefined)
  , addOriginGroupDevice: (id: string, serial: string) =>
    api.put(`/api/v1/devices/${serial}/groups/${id}`)
  , addOriginGroupDevices: (id: string, serials?: string[]) =>
    api.put(`/api/v1/devices/groups/${id}?fields=""`, serials ? {serials: serials.join()} : undefined)
  , removeOriginGroupDevice: (id: string, serial: string) =>
    api.delete(`/api/v1/devices/${serial}/groups/${id}`)
  , removeOriginGroupDevices: (id: string, serials?: string[]) =>
    api.delete(`/api/v1/devices/groups/${id}?fields=""`, serials ? {serials: serials.join()} : undefined)
}

export const deviceSettingsEvents = [
  'user.settings.devices.created'
  , 'user.settings.devices.deleted'
  , 'user.settings.devices.updated'
] as const
