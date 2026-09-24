import type {AlertMessage} from './alert-message'
import {api} from './api'
import type {User} from './app-state'

export interface UserRemovalFilters {
  groupOwner: 'Any' | 'True' | 'False' | string
}

function removalQuery(filters: UserRemovalFilters): string {
  return filters.groupOwner !== 'Any' ? `?groupOwner=${filters.groupOwner.toLowerCase()}` : ''
}

export const usersApi = {
  getUsers: (fields: string) => api.get<{users: User[]}>(`/api/v1/users?fields=${fields}`)
  , getUsersAlertMessage: () => api.get<{alertMessage: AlertMessage}>('/api/v1/users/alertMessage')
  , getUser: (email: string, fields: string) =>
    api.get<{user: User}>(`/api/v1/users/${email}?fields=${fields}`)
  , removeUser: (email: string, filters: UserRemovalFilters) =>
    api.delete(`/api/v1/users/${email}${removalQuery(filters)}`)
  , removeUsers: (filters: UserRemovalFilters, emails?: string[]) =>
    api.delete(`/api/v1/users${removalQuery(filters)}`, emails ? {emails: emails.join()} : undefined)
  , updateUserGroupsQuotas: (email: string, number: number, duration: number, repetitions: number) =>
    api.put(`/api/v1/users/${email}/groupsQuotas?number=${number}&duration=${duration}&repetitions=${repetitions}`)
  , updateDefaultUserGroupsQuotas: (number: number, duration: number, repetitions: number) =>
    api.put(`/api/v1/users/groupsQuotas?number=${number}&duration=${duration}&repetitions=${repetitions}`)
  , createUser: (name: string, email: string) =>
    api.post(`/api/v1/users/${email}?name=${name}`)
}

export const userSettingsEvents = [
  'user.settings.users.created'
  , 'user.settings.users.deleted'
  , 'user.settings.users.updated'
] as const

export const userViewEvents = ['user.view.users.updated'] as const
