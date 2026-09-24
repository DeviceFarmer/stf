import {ApiError} from '@/core/api'
import {getDateFormat} from '@/core/date-format'
import {devicesApi} from '@/core/devices-api'
import {groupsApi, type Group} from '@/core/groups-api'
import {gettext, translate} from '@/core/i18n'
import {openConfirm, withErrorModal} from '@/ui/modals'
import {flattenConflicts, isOriginGroup, type ScheduleDraft} from './rules'
import {setGroupConflicts} from './store'
import type {ServerConflict, SettingsDevice, SettingsUser} from './types'

function showConflicts(groupId: string, error: unknown): void {
  if (error instanceof ApiError && error.status === 409 && Array.isArray(error.data?.conflicts)) {
    const rows = flattenConflicts(
      error.data.conflicts as ServerConflict[]
      , getDateFormat()
    )
    setGroupConflicts(groupId, rows)
  }
}

async function withConflicts(groupId: string, action: () => Promise<unknown>): Promise<boolean> {
  const {error} = await withErrorModal(action)
  if (error) {
    showConflicts(groupId, error)
  }
  return !error
}

function confirmRemoval(message: string, askConfirmation: boolean): Promise<boolean> {
  if (!askConfirmation) {
    return Promise.resolve(true)
  }
  return openConfirm({title: translate('Warning'), message: translate(message), danger: true})
}

const serialsOf = (devices: SettingsDevice[]) => devices.map((device) => device.serial)
const emailsOf = (users: SettingsUser[]) => users.map((user) => user.email)

export async function createGroup(): Promise<Group | undefined> {
  const {value} = await withErrorModal(() => groupsApi.createGroup())
  return value?.group
}

export function updateGroupName(group: Group, name: string) {
  return withErrorModal(() => groupsApi.updateGroup(group.id, {name}))
}

export function updateGroupState(group: Group) {
  return withErrorModal(() => groupsApi.updateGroup(group.id, {state: 'ready'}))
}

export function updateGroupSchedule(group: Group, draft: ScheduleDraft): Promise<boolean> {
  return withConflicts(group.id, () => groupsApi.updateGroup(group.id, {
    class: draft.groupClass
    , repetitions: draft.repetitions
    , startTime: draft.start
    , stopTime: draft.stop
  }))
}

export async function removeGroup(group: Group, askConfirmation: boolean): Promise<boolean> {
  if (!await confirmRemoval(gettext('Really delete this group?'), askConfirmation)) {
    return false
  }
  const {error} = await withErrorModal(() => groupsApi.removeGroup(group.id))
  return !error
}

export async function removeGroups(groups: Group[], askConfirmation: boolean): Promise<boolean> {
  if (!await confirmRemoval(gettext('Really delete this selection of groups?'), askConfirmation)) {
    return false
  }
  const {error} = await withErrorModal(() => groupsApi.removeGroups(groups.map((group) => group.id)))
  return !error
}

export function addGroupDevice(group: Group, device: SettingsDevice): Promise<boolean> {
  if (isOriginGroup(group.class)) {
    return withErrorModal(() => devicesApi.addOriginGroupDevice(group.id, device.serial)).then(({error}) => !error)
  }
  return withConflicts(group.id, () => groupsApi.addGroupDevice(group.id, device.serial))
}

export function addGroupDevices(group: Group, devices: SettingsDevice[]): Promise<boolean> {
  if (isOriginGroup(group.class)) {
    return withErrorModal(() => devicesApi.addOriginGroupDevices(group.id, serialsOf(devices)))
      .then(({error}) => !error)
  }
  return withConflicts(group.id, () => groupsApi.addGroupDevices(group.id, serialsOf(devices)))
}

export async function removeGroupDevice(group: Group, device: SettingsDevice): Promise<boolean> {
  const {error} = await withErrorModal(() => (isOriginGroup(group.class) ?
    devicesApi.removeOriginGroupDevice(group.id, device.serial) :
    groupsApi.removeGroupDevice(group.id, device.serial)))
  return !error
}

export async function removeGroupDevices(group: Group, devices: SettingsDevice[]): Promise<boolean> {
  const {error} = await withErrorModal(() => (isOriginGroup(group.class) ?
    devicesApi.removeOriginGroupDevices(group.id, serialsOf(devices)) :
    groupsApi.removeGroupDevices(group.id, serialsOf(devices))))
  return !error
}

export async function addGroupUser(group: Group, user: SettingsUser): Promise<boolean> {
  const {error} = await withErrorModal(() => groupsApi.addGroupUser(group.id, user.email))
  return !error
}

export async function addGroupUsers(group: Group, users: SettingsUser[]): Promise<boolean> {
  const {error} = await withErrorModal(() => groupsApi.addGroupUsers(group.id, emailsOf(users)))
  return !error
}

export async function removeGroupUser(group: Group, user: SettingsUser): Promise<boolean> {
  const {error} = await withErrorModal(() => groupsApi.removeGroupUser(group.id, user.email))
  return !error
}

export async function removeGroupUsers(group: Group, users: SettingsUser[]): Promise<boolean> {
  const {error} = await withErrorModal(() => groupsApi.removeGroupUsers(group.id, emailsOf(users)))
  return !error
}
