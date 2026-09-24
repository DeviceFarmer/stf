import {api} from './api'
import type {Device} from './devices/types'

export interface Group {
  id: string
  name: string
  class: string
  state?: string
  privilege?: string
  owner: {email: string, name: string}
  users: string[]
  devices: string[]
  dates: Array<{start: string, stop: string}>
  duration?: number
  repetitions?: number
  isActive?: boolean
  envUserGroupsNumber?: boolean
  envUserGroupsDuration?: boolean
  envUserGroupsRepetitions?: boolean
  createdAt?: string
  lock?: {admin: boolean, user: boolean}
  [key: string]: any
}

export const groupsApi = {
  getGroupUsers: (id: string, fields: string) =>
    api.get<{users: any[]}>(`/api/v1/groups/${id}/users?fields=${fields}`)
  , getGroupDevices: (id: string, bookable: boolean, fields: string) =>
    api.get<{devices: Device[]}>(`/api/v1/groups/${id}/devices?bookable=${bookable}&fields=${fields}`)
  , addGroupDevice: (id: string, serial: string) =>
    api.put(`/api/v1/groups/${id}/devices/${serial}`)
  , addGroupDevices: (id: string, serials?: string[]) =>
    api.put(`/api/v1/groups/${id}/devices`, serials ? {serials: serials.join()} : undefined)
  , removeGroupDevice: (id: string, serial: string) =>
    api.delete(`/api/v1/groups/${id}/devices/${serial}`)
  , removeGroupDevices: (id: string, serials?: string[]) =>
    api.delete(`/api/v1/groups/${id}/devices`, serials ? {serials: serials.join()} : undefined)
  , addGroupUser: (id: string, email: string) =>
    api.put(`/api/v1/groups/${id}/users/${email}`)
  , addGroupUsers: (id: string, emails?: string[]) =>
    api.put(`/api/v1/groups/${id}/users`, emails ? {emails: emails.join()} : undefined)
  , removeGroupUser: (id: string, email: string) =>
    api.delete(`/api/v1/groups/${id}/users/${email}`)
  , removeGroupUsers: (id: string, emails?: string[]) =>
    api.delete(`/api/v1/groups/${id}/users`, emails ? {emails: emails.join()} : undefined)
  , getGroups: () => api.get<{groups: Group[]}>('/api/v1/groups')
  , getMyGroups: () => api.get<{groups: Group[]}>('/api/v1/groups?owner=true')
  , getGroup: (id: string) => api.get<{group: Group}>(`/api/v1/groups/${id}`)
  , removeGroup: (id: string) => api.delete(`/api/v1/groups/${id}`)
  , removeGroups: (ids?: string[]) =>
    api.delete(`/api/v1/groups?_=${Date.now()}`, ids ? {ids: ids.join()} : undefined)
  , createGroup: () => api.post<{group: Group}>('/api/v1/groups', {state: 'pending'})
  , updateGroup: (id: string, data: Record<string, unknown>) =>
    api.put<{group: Group}>(`/api/v1/groups/${id}`, data)
}

export const groupSettingsEvents = [
  'user.settings.groups.created'
  , 'user.settings.groups.deleted'
  , 'user.settings.groups.updated'
] as const

export const groupViewEvents = [
  'user.view.groups.created'
  , 'user.view.groups.deleted'
  , 'user.view.groups.updated'
] as const
