import type {EventEmitter} from 'events'
import type {Readable} from 'stream'
import type Bluebird from 'bluebird'
import type EventEmitter3 from 'eventemitter3'
import type protobufjs from 'protobufjs'
import type deviceData from '@devicefarmer/stf-device-db'
import type adbutil from '../util/adbutil.js'
import type devutil from '../util/devutil.js'
import type zmqutil from '../util/zmqutil.js'
import type wirerouter from '../wire/router.js'
import type ChannelManager from '../wire/channelmanager.js'
import type {ConnectStartMessageFields, LogcatFilter, OwnerMessage} from './wire.js'
import type {
  AirplaneModeEvent
, BatteryEvent
, BrowserPackageEvent
, ConnectivityEvent
, GetBrowsersResponse
, PhoneStateEvent
, RotationEvent
, StfServiceWire
} from './stfservice-wire.js'

export type Adb = ReturnType<typeof adbutil>
export type Router = ReturnType<typeof wirerouter>
export type ZmqSocket = ReturnType<typeof zmqutil.socket>
export type Channels = ChannelManager
export type LocalSocket = Awaited<ReturnType<typeof devutil.waitForLocalSocket>>
export type Identity = ReturnType<typeof devutil.makeIdentity>
export type DeviceData = NonNullable<ReturnType<typeof deviceData.find>>
export type DeviceFlags = NonNullable<DeviceData['flags']>

export type NonNullableFields<T> = {[K in keyof T]: NonNullable<T[K]>}

export interface DevicePluginOptions {
  serial: string
  publicIp: string
  storageUrl: string
  groupTimeout: number
  screenReset: boolean
  lockRotation?: boolean
  connectPort: number
  connectUrlPattern: string
  cleanup: boolean
  cleanupFolder: string[]
  cleanupDisableBluetooth: boolean
  cleanupBluetoothBonds: boolean
  muteMaster: 'always' | 'inuse' | 'never'
  heartbeatInterval: number
  screenGrabber: string
}

export interface StfServiceResource {
  requiredVersion: string
  pkg: string
  main: string
  apk: string
  wire: StfServiceWire
  builder: protobufjs.Root
  startIntent: {
    action: string
    component: string
  }
  path: string
}

export interface SdkInfo {
  level: number
}

export interface MinicapResource {
  run(mode: string, cmd: string): ReturnType<Adb['shell']>
}

export interface ScreenOptions {
  publicUrl: string
}

export interface TouchPoint {
  x: number
  y: number
}

export interface TouchPlugin {
  tap(point: TouchPoint): void
}

export interface StorageMeta {
  filename: string
  contentType: string
  knownLength: number
}

export interface StoragePlugin {
  store(type: string, stream: Readable, meta: StorageMeta): Bluebird<unknown>
}

export interface DisplayProperties {
  id: number
  width: number
  height: number
  xdpi: number
  ydpi: number
  fps: number
  density: number
  rotation: number
  secure: boolean
  size: number
  url?: string
}

export interface DisplayEvents {
  rotationChange: [rotation: number]
}

export interface DeviceDisplay extends EventEmitter3.EventEmitter<DisplayEvents> {
  id: number
  properties: DisplayProperties
  updateRotation(newRotation: number): void
}

export type PhoneProperties = Record<string, string>

export type DeviceIdentity = Identity & {
  display: DisplayProperties
  phone: PhoneProperties
}

export interface Flags {
  has(flag: keyof DeviceFlags): boolean | null | undefined
  get<K extends keyof DeviceFlags, D>(flag: K, defaultValue: D): DeviceFlags[K] | D
}

export type UrlFormat = (template: string, port: number) => string

export interface ServiceEvents {
  airplaneModeChange: [event: AirplaneModeEvent]
  batteryChange: [event: BatteryEvent]
  browserPackageChange: [event: BrowserPackageEvent]
  connectivityChange: [event: ConnectivityEvent]
  phoneStateChange: [event: PhoneStateEvent]
  rotationChange: [event: RotationEvent]
}

export type BrowserList = Omit<GetBrowsersResponse, 'success'>

export interface AccountQuery {
  type: string | null
}

export interface AccountRemoval {
  type: string
  account: string | null
}

export interface ServicePlugin extends EventEmitter<ServiceEvents> {
  type(text: string): void
  paste(text: string): Bluebird<void>
  copy(): Bluebird<string | null>
  getDisplay(id: number): Bluebird<DisplayProperties>
  wake(): void
  rotate(rotation: number): void
  freezeRotation(rotation: number): void
  thawRotation(): void
  version(): Bluebird<string | null>
  unlock(): Bluebird<void>
  lock(): Bluebird<void>
  acquireWakeLock(): Bluebird<void>
  releaseWakeLock(): Bluebird<void>
  identity(): Bluebird<void>
  setClipboard(text: string): Bluebird<void>
  getClipboard(): Bluebird<string | null>
  getBrowsers(): Bluebird<BrowserList>
  getProperties(properties: string[]): Bluebird<PhoneProperties>
  getAccounts(data: AccountQuery): Bluebird<string[]>
  removeAccount(data: AccountRemoval): Bluebird<boolean>
  addAccountMenu(): Bluebird<boolean>
  cleanupBondedBluetoothDevices(): Bluebird<boolean>
  setRingerMode(mode: number): Bluebird<void>
  getRingerMode(): Bluebird<string>
  setWifiEnabled(enabled: boolean): Bluebird<void>
  getWifiStatus(): Bluebird<boolean>
  setBluetoothEnabled(enabled: boolean): Bluebird<void>
  cleanBluetoothBonds(): Bluebird<void>
  getBluetoothStatus(): Bluebird<boolean>
  getSdStatus(ignored?: unknown): Bluebird<boolean>
  pressKey(key: string): Bluebird<boolean>
  setMasterMute(mode: boolean): Bluebird<void>
}

export interface SoloPlugin {
  channel: string
  poke(): void
}

export interface GroupEvents {
  join: [group: OwnerMessage, identifier?: string | undefined]
  leave: [group: OwnerMessage]
  autojoin: [identifier: string, joined: boolean]
}

export interface GroupPlugin extends EventEmitter<GroupEvents> {
  get(): Bluebird<OwnerMessage>
  join(
    newGroup: OwnerMessage
  , timeout?: number | null
  , usage?: string | null
  , identifier?: string
  ): Bluebird<OwnerMessage>
  keepalive(): void
  leave(reason: string): Bluebird<OwnerMessage>
}

export interface ConnectPlugin {
  port: number
  url: string
  start(message: ConnectStartMessageFields | null): Bluebird<string>
  stop(): Bluebird<void>
  end(): Bluebird<void>
  isRunning(): boolean
}

export interface LogcatPlugin {
  start(filters: LogcatFilter[]): Bluebird<void>
  stop(): Bluebird<void>
  reset(filters: LogcatFilter[]): Bluebird<void>
  isRunning(): boolean
}

export interface FilesystemPlugin {
  retrieve(file: string): Bluebird<unknown>
}

export interface CleanupPlugin {
  removePackages(): Bluebird<unknown[]>
  disableBluetooth(): Bluebird<void>
  cleanBluetoothBonds(): Bluebird<void>
  cleanFolders(): Bluebird<string[]>
}
