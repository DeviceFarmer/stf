import type {Expression, WriteResultWithChanges} from 'rethinkdb'
import type {
  DeviceBrowserAppMessageFields
, DeviceDisplayMessageFields
, DevicePhoneMessageFields
, ReverseForwardFields
} from './wire.js'

export interface GroupOwner {
  email: string
  name: string
}

export interface GroupDates {
  start: Date
  stop: Date
}

export interface GroupLock {
  user: boolean
  admin: boolean
}

export interface GroupDocument {
  id: string
  name: string
  owner: GroupOwner
  users: string[]
  devices: string[]
  privilege: string
  class: string
  repetitions: number
  duration: number
  isActive: boolean
  state: string
  dates: GroupDates[]
  createdAt: Date
  lock: GroupLock
  envUserGroupsNumber?: number
  envUserGroupsDuration?: number
  envUserGroupsRepetitions?: number
  ticket: GroupTicket | null
}

export interface UserQuota {
  number: number
  duration: number
}

export interface UserGroups {
  subscribed: string[]
  lock: boolean
  quotas: {
    allocated: UserQuota
    consumed: UserQuota
    defaultGroupsNumber: number
    defaultGroupsDuration: number
    defaultGroupsRepetitions: number
    repetitions: number
  }
}

export interface UserDocument {
  email: string
  name: string
  ip: string
  group: string
  privilege: string
  lastLoggedInAt: Date
  createdAt: Date
  forwards: unknown[]
  settings: UserSettings
  groups: UserGroups
  adbKeys?: AdbKey[]
}

export interface DeviceOwner {
  email: string
  name: string
  group: string
}

export interface DeviceGroup {
  id: string
  name: string
  lifeTime: GroupDates
  owner: GroupOwner
  origin: string
  class: string
  repetitions: number
  originName: string
  lock: boolean
}

export interface DeviceDocument {
  serial: string
  present: boolean
  ready: boolean
  status: number
  channel: string
  owner: DeviceOwner | null
  group: DeviceGroup
  provider: {
    name: string
    channel: string
  }
  createdAt: Date
  presenceChangedAt: Date
  statusChangedAt: Date
  statusTimeStamp: number
  reverseForwards: ReverseForwardFields[]
  remoteConnect: boolean
  remoteConnectUrl: string | null
  usage: string | null
  usageChangedAt?: Date
  logs_enabled: boolean
  restoreOwner?: DeviceRestoreOwner | null
  airplaneMode?: boolean
  battery?: DeviceBattery
  browser?: DeviceBrowser
  network?: DeviceNetwork
  display?: Partial<DeviceDisplayMessageFields>
  notes?: string
  platform?: string
  manufacturer?: string
  operator?: string | null
  model?: string
  version?: string
  abi?: string
  sdk?: string
  phone?: DevicePhoneMessageFields
  product?: string | null
  cpuPlatform?: string | null
  openGLESVersion?: string | null
  marketName?: string | null
}

export interface AccessTokenDocument {
  id: string
  email: string
  title: string
  jwt: string
}

export interface GroupTicket {
  serial: string
  signature: string
}

export interface AlertMessage {
  activation: string
  data: string
  level: string
}

export interface UserSettings {
  alertMessage?: AlertMessage
  [key: string]: unknown
}

export interface AdbKey {
  title: string
  fingerprint: string
  publicKey?: string
}

export interface DeviceRestoreOwner {
  email: string
  usage: string | null
  expiresAt: number
}

export interface DeviceBattery {
  status: string
  health: string
  source: string
  level: number
  scale: number
  temp: number
  voltage: number
}

export interface DeviceBrowser {
  selected: boolean
  apps: DeviceBrowserAppMessageFields[]
}

export interface DeviceConnectivity {
  connected: boolean
  type: string | null
  subtype: string | null
  failover: boolean | null
  roaming: boolean | null
}

export interface DevicePhoneState {
  state: string
  manual: boolean
  operator: string | null
}

export interface DeviceNetwork {
  connected?: boolean
  type?: string | null
  subtype?: string | null
  failover?: boolean
  roaming?: boolean
  state?: string
  manual?: boolean
  operator?: string | null
}

export interface DeviceIdentity {
  platform: string
  manufacturer: string
  operator: string | null
  model: string
  version: string
  abi: string
  sdk: string
  display: Partial<DeviceDisplayMessageFields>
  phone: DevicePhoneMessageFields
  product: string | null
  cpuPlatform: string | null
  openGLESVersion: string | null
  marketName: string | null
}

export interface DeviceLogEntry {
  timestamp: number
  priority: number
  tag: string
  pid: number
  message: string
}

export interface DeviceInitialState {
  provider: {
    name: string
    channel: string
  }
  status: number
  statusTimeStamp: number
}

export interface GroupCreateData {
  name: string
  owner: GroupOwner
  users?: string[]
  privilege: string
  class: string
  repetitions: number
  duration: number
  isActive: boolean
  state: string
  dates: GroupDates[]
  envUserGroupsNumber?: number
  envUserGroupsDuration?: number
  envUserGroupsRepetitions?: number
}

export interface BootStrapEnv {
  STF_ROOT_GROUP_NAME: string
  STF_ADMIN_NAME: string
  STF_ADMIN_EMAIL: string
}

export type UserIdentity = Pick<UserDocument, 'email' | 'name' | 'group'>

export type DbIndexSpec = {
  indexFunction?: (row: Expression<unknown>) => unknown
  options?: {multi?: boolean}
} | null | false

export interface DbTableSpec {
  primaryKey: string
  indexes?: Record<string, DbIndexSpec>
}

export type GroupRef = Pick<GroupDocument, 'id'>

export type CreatedUserGroup = GroupDocument | null | false

export interface AdminGroupLock {
  group?: GroupDocument
}

export type LockedWriteResult = WriteResultWithChanges & {locked: boolean}
