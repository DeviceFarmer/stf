export type DeviceState =
  | 'absent'
  | 'present'
  | 'offline'
  | 'unauthorized'
  | 'preparing'
  | 'ready'
  | 'using'
  | 'busy'
  | 'available'
  | 'automation'

export interface DeviceOwner {
  email: string
  name?: string
  group?: string
}

export interface DeviceGroup {
  id: string
  name: string
  class?: string
  origin?: string
  originName?: string
  lifeTime?: {start: string, stop: string}
  owner: DeviceOwner
  lock?: boolean
  repetitions?: number
}

export interface DeviceDisplay {
  id?: number
  width: number
  height: number
  rotation: number
  density?: number
  fps?: number
  size?: number
  xdpi?: number
  ydpi?: number
  secure?: boolean
  url?: string
  inches?: number
}

export interface DeviceBattery {
  health: string
  level: number
  scale: number
  source: string
  status: string
  temp: number
  voltage: number
}

export interface DeviceBrowserApp {
  id: string
  name: string
  type: string
  selected: boolean
  system: boolean
  developer: string
}

export interface DeviceNetwork {
  connected: boolean
  type: string | null
  subtype: string | null
  failover: boolean
  roaming: boolean
  manual?: boolean
}

export interface Device {
  serial: string
  present: boolean
  ready: boolean
  status: number
  statusTimeStamp?: string
  using?: boolean
  usage?: string | null
  usable?: boolean
  owner?: DeviceOwner | null
  group: DeviceGroup
  channel: string
  platform?: string
  manufacturer?: string
  model?: string
  name?: string
  marketName?: string
  image?: string
  version?: string
  sdk?: string
  abi?: string
  cpuPlatform?: string
  openGLESVersion?: string
  operator?: string | null
  notes?: string
  airplaneMode?: boolean
  releasedAt?: string
  likelyLeaveReason?: string
  display?: DeviceDisplay
  battery?: DeviceBattery
  browser?: {selected: boolean, apps: DeviceBrowserApp[]}
  network?: DeviceNetwork
  phone?: {imei?: string, imsi?: string, phoneNumber?: string, iccid?: string, network?: string}
  provider?: {name: string, channel: string}
  memory?: {ram?: number, rom?: number}
  cpu?: {cores?: number, freq?: number, name?: string}
  reverseForwards?: Array<{id: string, devicePort: number, targetHost: string, targetPort: number}>
  state: DeviceState
  enhancedName: string
  enhancedModel: string
  enhancedImage120: string
  enhancedImage24: string
  enhancedStateAction: string
  enhancedStatePassive: string
  enhancedBatteryPercentage?: string
  enhancedBatteryHealth?: string
  enhancedBatterySource?: string
  enhancedBatteryStatus?: string
  enhancedBatteryTemp?: string
  enhancedUserProfileUrl?: string | undefined
  enhancedUserName?: string
  enhancedGroupOwnerProfileUrl?: string | undefined
  [key: string]: any
}
