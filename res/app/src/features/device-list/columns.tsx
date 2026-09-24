import type {ReactNode} from 'react'
import {getClassName} from '@/core/common'
import {batteryHealths, batterySources, batteryStatuses} from '@/core/devices/enhance'
import type {Device, DeviceState} from '@/core/devices/types'
import {formatDate, getDateFormat} from '@/core/date-format'
import {gettext, translate} from '@/core/i18n'
import {BrowserIcons, ExternalLink, ModelCell, NameLink, NoteCell, StatusButton} from './cells'
import type {DeviceActions} from './device-actions'
import type {QueryTerm} from './query-parser'

export type SortOrder = 'asc' | 'desc'

export interface CellContext {
  actions: DeviceActions
  userEmail: string
  dateFormat: string
  language: string
  onImage: (device: Device) => void
}

export interface DeviceColumn {
  title: string
  defaultOrder: SortOrder
  compare: (a: Device, b: Device, language: string) => number
  filter: (device: Device, term: QueryTerm, language: string) => boolean
  render: (device: Device, context: CellContext) => ReactNode
}

type Operator = (value: any, filterValue: any) => boolean

const filterOps: Record<string, Operator> = {
  '<': (value, filterValue) => value !== null && value < filterValue
  , '<=': (value, filterValue) => value !== null && value <= filterValue
  , '>': (value, filterValue) => value !== null && value > filterValue
  , '>=': (value, filterValue) => value !== null && value >= filterValue
  , '=': (value, filterValue) => value !== null && value === filterValue
}

function operator(op: string | null): Operator {
  return filterOps[op || '=']
}

function compareIgnoreCase(a: unknown, b: unknown): number {
  const la = String(a).toLowerCase()
  const lb = String(b).toLowerCase()
  if (la === lb) {
    return 0
  }
  return la < lb ? -1 : 1
}

function compareRespectCase(a: any, b: any): number {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

function filterIgnoreCase(value: unknown, query: string): boolean {
  return String(value).toLowerCase().indexOf(String(query).toLowerCase()) !== -1
}

function translated(language: string, value?: string | null): string {
  return value ? translate(value, undefined, language) : ''
}

function lookup(language: string, table: Record<string, string>, key?: string): string {
  return key && Object.hasOwn(table, key) ? translate(table[key], undefined, language) : '-'
}

function dateNumber(date: Date | null): number {
  return date ? date.getFullYear() * 10000 + date.getMonth() * 100 + date.getDate() : 0
}

interface GroupDates {
  format: string
  start: string
  stop: string
}

const groupDatesCache = new WeakMap<Device, GroupDates>()

function groupDates(device: Device): GroupDates {
  const format = getDateFormat()
  const cached = groupDatesCache.get(device)
  if (cached?.format === format) {
    return cached
  }
  const dates = {
    format
    , start: formatDate(device.group?.lifeTime?.start, format)
    , stop: formatDate(device.group?.lifeTime?.stop, format)
  }
  groupDatesCache.set(device, dates)
  return dates
}

function textColumn(
  title: string
, value: (device: Device, language: string) => string
, overrides: Partial<DeviceColumn> = {}
): DeviceColumn {
  return {
    title
    , defaultOrder: 'asc'
    , compare: (a, b, language) => compareIgnoreCase(value(a, language), value(b, language))
    , filter: (device, term, language) => filterIgnoreCase(value(device, language), term.query)
    , render: (device, context) => value(device, context.language)
    , ...overrides
  }
}

function numberColumn(
  title: string
, value: (device: Device) => number | null
, format: (value: number | null) => string
, overrides: Partial<DeviceColumn> = {}
): DeviceColumn {
  return {
    title
    , defaultOrder: 'asc'
    , compare: (a, b) => (value(a) || 0) - (value(b) || 0)
    , filter: (device, term) => operator(term.op)(value(device), Number(term.query))
    , render: (device) => format(value(device))
    , ...overrides
  }
}

function dateColumn(title: string, value: (device: Device) => Date | null): DeviceColumn {
  return {
    title
    , defaultOrder: 'desc'
    , compare: (a, b) => (value(a)?.getTime() || 0) - (value(b)?.getTime() || 0)
    , filter: (device, term) =>
      operator(term.op)(dateNumber(value(device)), dateNumber(new Date(term.query)))
    , render: (device) => formatDate(value(device), 'yyyy-MM-dd')
  }
}

function linkColumn(
  title: string
, value: (device: Device, language: string) => string
, link: (device: Device) => string | undefined
): DeviceColumn {
  return textColumn(title, value, {
    render: (device, context) => <ExternalLink label={value(device, context.language)} href={link(device)} />
  })
}

const stateOrder: Record<DeviceState, number> = {
  using: 10
  , automation: 15
  , available: 20
  , busy: 30
  , ready: 40
  , preparing: 50
  , unauthorized: 60
  , offline: 70
  , present: 80
  , absent: 90
}

function versionParts(version?: string): string[] {
  return (version || '0').split('.')
}

function compareVersions(deviceA: Device, deviceB: Device): number {
  const va = versionParts(deviceA.version)
  const vb = versionParts(deviceB.version)
  for (let i = 0, l = Math.max(va.length, vb.length); i < l; ++i) {
    const a = i < va.length ? parseInt(va[i], 10) : 0
    const b = i < vb.length ? parseInt(vb[i], 10) : 0
    const diff = Number.isNaN(a - b) ? compareRespectCase(va[i], vb[i]) : a - b
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

function filterVersion(device: Device, term: QueryTerm): boolean {
  const va = versionParts(device.version)
  const vb = versionParts(term.query)
  const op = operator(term.op)

  if (term.op === null && term.field === null && vb.length === 1) {
    return false
  }

  if (vb[vb.length - 1] === '') {
    vb.pop()
  }

  for (let i = 0, l = Math.min(va.length, vb.length); i < l; ++i) {
    const a = parseInt(va[i], 10)
    const b = parseInt(vb[i], 10)
    const matched = Number.isNaN(a) || Number.isNaN(b) ? op(va[i], vb[i]) : op(a, b)
    if (!matched) {
      return false
    }
  }

  return true
}

function networkValue(device: Device): string {
  if (!device.network || !device.network.connected) {
    return ''
  }
  if (device.network.subtype) {
    return `${device.network.type} (${device.network.subtype})`.toUpperCase()
  }
  return (device.network.type || '').toUpperCase()
}

function displayArea(device: Device): number {
  return device.display && device.display.width ? device.display.width * device.display.height : 0
}

function browserApps(device: Device) {
  return device.browser?.apps || []
}

function modelValue(device: Device): string {
  return device.model || device.serial
}

function productValue(device: Device): string {
  return device.name || device.model || device.serial
}

function batteryLevel(device: Device): number | null {
  return device.battery ? Math.floor(device.battery.level / device.battery.scale * 100) : null
}

const definitions: Record<string, DeviceColumn> = {
  state: {
    title: gettext('Status')
    , defaultOrder: 'asc'
    , compare: (a, b) => (stateOrder[a.state] ?? 100) - (stateOrder[b.state] ?? 100)
    , filter: (device, term) => device.state === term.query
    , render: (device, context) => <StatusButton device={device} actions={context.actions} />
  }
  , group: textColumn(gettext('Group Name'), (device, language) => translated(language, device.group?.name))
  , groupSchedule: textColumn(gettext('Group Class'), (device, language) =>
    (device.group?.class ? getClassName(device.group.class, language) || device.group.class : ''))
  , groupOwner: linkColumn(
    gettext('Group Owner')
    , (device, language) => translated(language, device.group?.owner?.name)
    , (device) => device.enhancedGroupOwnerProfileUrl
  )
  , groupEndTime: textColumn(gettext('Group Expiration Date'), (device) => groupDates(device).stop)
  , groupStartTime: textColumn(gettext('Group Starting Date'), (device) => groupDates(device).start)
  , groupRepetitions: textColumn(gettext('Group Repetitions'), (device) =>
    (device.group?.repetitions === undefined ? '' : String(device.group.repetitions)))
  , groupOrigin: textColumn(gettext('Group Origin'), (device, language) =>
    translated(language, device.group?.originName))
  , model: textColumn(gettext('Model'), modelValue, {
    compare: (a, b) => compareRespectCase(modelValue(a), modelValue(b))
    , render: (device, context) =>
      <ModelCell device={device} label={modelValue(device)} onImage={context.onImage} />
  })
  , name: textColumn(gettext('Product'), productValue, {
    render: (device, context) => (
      <NameLink
        device={device}
        label={productValue(device)}
        actions={context.actions}
        userEmail={context.userEmail}
      />
    )
  })
  , operator: textColumn(gettext('Carrier'), (device) => device.operator || '')
  , releasedAt: dateColumn(gettext('Released'), (device) =>
    (device.releasedAt ? new Date(device.releasedAt) : null))
  , version: textColumn(gettext('OS'), (device) => device.version || '', {
    compare: compareVersions
    , filter: filterVersion
  })
  , network: textColumn(gettext('Network'), networkValue)
  , display: textColumn(gettext('Screen'), (device) =>
    (device.display && device.display.width ? `${device.display.width}x${device.display.height}` : ''), {
    defaultOrder: 'desc'
    , compare: (a, b) => displayArea(a) - displayArea(b)
  })
  , browser: {
    title: gettext('Browser')
    , defaultOrder: 'asc'
    , compare: (a, b) => browserApps(a).length - browserApps(b).length
    , filter: (device, term) => browserApps(device).some((app) => filterIgnoreCase(app.type, term.query))
    , render: (device) => <BrowserIcons apps={browserApps(device)} />
  }
  , serial: textColumn(gettext('Serial'), (device) => device.serial || '')
  , manufacturer: textColumn(gettext('Manufacturer'), (device) => device.manufacturer || '')
  , marketName: textColumn(gettext('Market name'), (device) => device.marketName || '')
  , sdk: numberColumn(
    gettext('SDK')
    , (device) => (device.sdk ? Number(device.sdk) : null)
    , (value) => (value ? String(value) : '')
    , {defaultOrder: 'desc'}
  )
  , abi: textColumn(gettext('ABI'), (device) => device.abi || '')
  , cpuPlatform: textColumn(gettext('CPU Platform'), (device) => device.cpuPlatform || '')
  , openGLESVersion: textColumn(gettext('OpenGL ES version'), (device) => device.openGLESVersion || '')
  , phone: textColumn(gettext('Phone'), (device) => device.phone?.phoneNumber || '')
  , imei: textColumn(gettext('Phone IMEI'), (device) => device.phone?.imei || '')
  , imsi: textColumn(gettext('Phone IMSI'), (device) => device.phone?.imsi || '')
  , iccid: textColumn(gettext('Phone ICCID'), (device) => device.phone?.iccid || '')
  , batteryHealth: textColumn(gettext('Battery Health'), (device, language) =>
    (device.battery ? lookup(language, batteryHealths, device.battery.health) : ''))
  , batterySource: textColumn(gettext('Battery Source'), (device, language) =>
    (device.battery ? lookup(language, batterySources, device.battery.source) : ''))
  , batteryStatus: textColumn(gettext('Battery Status'), (device, language) =>
    (device.battery ? lookup(language, batteryStatuses, device.battery.status) : ''))
  , batteryLevel: numberColumn(
    gettext('Battery Level')
    , batteryLevel
    , (value) => (value === null ? '' : `${value}%`)
  )
  , batteryTemp: numberColumn(
    gettext('Battery Temp')
    , (device) => (device.battery ? device.battery.temp : null)
    , (value) => (value === null ? '' : `${value}°C`)
  )
  , provider: textColumn(gettext('Location'), (device) => device.provider?.name || '')
  , notes: textColumn(gettext('Notes'), (device) => device.notes || '', {
    render: (device) => <NoteCell device={device} />
  })
  , owner: linkColumn(
    gettext('User')
    , (device) => device.owner?.name || ''
    , (device) => (device.owner ? device.enhancedUserProfileUrl : undefined)
  )
}

export function columnDefinition(name: string): DeviceColumn | undefined {
  return Object.hasOwn(definitions, name) ? definitions[name] : undefined
}

export interface ColumnSetting {
  name: string
  selected: boolean
}

const selectedByDefault = new Set([
  'state'
  , 'model'
  , 'name'
  , 'operator'
  , 'releasedAt'
  , 'version'
  , 'provider'
  , 'notes'
  , 'owner'
])

const defaultOrder = [
  'state'
  , 'model'
  , 'name'
  , 'serial'
  , 'operator'
  , 'releasedAt'
  , 'version'
  , 'network'
  , 'display'
  , 'manufacturer'
  , 'marketName'
  , 'sdk'
  , 'abi'
  , 'cpuPlatform'
  , 'openGLESVersion'
  , 'browser'
  , 'phone'
  , 'imei'
  , 'imsi'
  , 'iccid'
  , 'batteryHealth'
  , 'batterySource'
  , 'batteryStatus'
  , 'batteryLevel'
  , 'batteryTemp'
  , 'provider'
  , 'notes'
  , 'owner'
  , 'group'
  , 'groupSchedule'
  , 'groupStartTime'
  , 'groupEndTime'
  , 'groupRepetitions'
  , 'groupOwner'
  , 'groupOrigin'
]

export const defaultColumns: ColumnSetting[] = defaultOrder.map((name) => ({
  name
  , selected: selectedByDefault.has(name)
}))
