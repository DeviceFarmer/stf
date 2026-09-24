import {getClassDuration} from '@/core/common'
import {formatDate} from '@/core/date-format'
import {gettext} from '@/core/i18n'
import type {Group} from '@/core/groups-api'
import type {ConflictRow, ServerConflict, SettingsDevice, SettingsUser} from './types'

export const groupNameRegex = /^[0-9a-zA-Z-_./: ]{1,50}$/
export const groupNameRegexStr = String(groupNameRegex)

export interface ScheduleDraft {
  groupClass: string
  repetitions: number
  start: Date
  stop: Date
}

export function isOriginGroup(groupClass?: string): boolean {
  return groupClass === 'bookable' || groupClass === 'standard'
}

export function isNoRepetitionsGroup(groupClass?: string): boolean {
  return isOriginGroup(groupClass) || groupClass === 'once'
}

export function isAdminUser(user: {privilege?: string}): boolean {
  return user.privilege === 'admin'
}

export function checkDurationQuota(
  group: Group
, owner: SettingsUser | undefined
, deviceNumber: number
, start: string | Date
, stop: string | Date
, repetitions: number
): boolean {
  if (isOriginGroup(group.class)) {
    return true
  }
  const allocated = owner?.groups?.quotas?.allocated?.duration
  if (typeof allocated !== 'number') {
    return false
  }
  const duration =
    (group.devices.length + deviceNumber) *
    (new Date(stop).getTime() - new Date(start).getTime()) *
    (repetitions + 1)
  return duration <= allocated
}

export function canAddDevices(group: Group, owner: SettingsUser | undefined, deviceNumber: number): boolean {
  const dates = group.dates?.[0]
  if (!dates) {
    return isOriginGroup(group.class)
  }
  return checkDurationQuota(group, owner, deviceNumber, dates.start, dates.stop, group.repetitions || 0)
}

export function canRemoveGroupUser(group: Group, user: SettingsUser): boolean {
  return user.privilege !== 'admin' && user.email !== group.owner.email
}

export function scheduleDraftOf(group: Group): ScheduleDraft {
  return {
    groupClass: group.class
    , repetitions: group.repetitions || 0
    , start: new Date(group.dates?.[0]?.start || NaN)
    , stop: new Date(group.dates?.[0]?.stop || NaN)
  }
}

function isSameTime(date: Date, value?: string): boolean {
  return date.getTime() === new Date(value || NaN).getTime()
}

export function validateSchedule(
  group: Group
, draft: ScheduleDraft
, context: {admin: boolean, owner?: SettingsUser}
): string {
  if (Number.isNaN(draft.start.getTime()) || Number.isNaN(draft.stop.getTime()) ||
      !Number.isFinite(draft.repetitions)) {
    return gettext('Bad syntax')
  }
  const changed =
    draft.groupClass !== group.class ||
    draft.repetitions !== (group.repetitions || 0) ||
    !isSameTime(draft.start, group.dates?.[0]?.start) ||
    !isSameTime(draft.stop, group.dates?.[0]?.stop)
  if (!changed) {
    return gettext('No change')
  }
  if (!isNoRepetitionsGroup(draft.groupClass) && draft.repetitions === 0) {
    return gettext('Repetitions must be > 0 for this Class')
  }
  if (draft.start >= draft.stop) {
    return gettext('Starting date >= Expiration date')
  }
  const classDuration = getClassDuration(draft.groupClass)
  if (typeof classDuration !== 'number' || draft.stop.getTime() - draft.start.getTime() > classDuration) {
    return gettext('(Expiration date - Starting date) must be <= Class duration')
  }
  if (context.admin && group.devices.length &&
      isOriginGroup(group.class) !== isOriginGroup(draft.groupClass)) {
    return gettext('Unauthorized class while device list is not empty')
  }
  if (!checkDurationQuota(group, context.owner, 0, draft.start, draft.stop, draft.repetitions)) {
    return gettext('Group duration quotas is reached')
  }
  return ''
}

export function flattenConflicts(conflicts: ServerConflict[], dateFormat: string): ConflictRow[] {
  const rows: ConflictRow[] = []
  for (const conflict of conflicts) {
    for (const serial of conflict.devices || []) {
      rows.push({
        serial
        , startDate: formatDate(conflict.date.start, dateFormat)
        , stopDate: formatDate(conflict.date.stop, dateFormat)
        , start: new Date(conflict.date.start).getTime()
        , stop: new Date(conflict.date.stop).getTime()
        , group: conflict.group
        , ownerName: conflict.owner?.name
        , ownerEmail: conflict.owner?.email
      })
    }
  }
  return rows
}

const classColors: Record<string, string> = {
  once: 'gray'
  , hourly: 'cyan'
  , daily: 'cyan'
  , weekly: 'cyan'
  , monthly: 'cyan'
  , quaterly: 'cyan'
  , halfyearly: 'cyan'
  , yearly: 'cyan'
  , debug: 'orange'
  , bookable: 'violet'
  , standard: 'teal'
}

export function classColor(groupClass: string): string {
  return classColors[groupClass] || 'gray'
}

export function groupStatus(group: Group): {label: string, color: string} {
  if (group.state === 'pending') {
    return {label: gettext('Pending'), color: 'blue'}
  }
  if (group.isActive) {
    return {label: gettext('Active'), color: 'green'}
  }
  return {label: gettext('Inactive'), color: 'yellow'}
}

export function networkOf(device: SettingsDevice): string {
  if (!device.network?.type) {
    return ''
  }
  return device.network.subtype ? `${device.network.type} (${device.network.subtype})` : device.network.type
}

export function screenOf(device: SettingsDevice): string {
  return device.display?.width ? `${device.display.width}x${device.display.height}` : ''
}

export function screenArea(device: SettingsDevice): number {
  return (device.display?.width || 0) * (device.display?.height || 0)
}
