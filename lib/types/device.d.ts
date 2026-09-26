import type {Duplex, Readable} from 'stream'
import type {Properties as AdbProperties} from '@devicefarmer/adbkit'
import type Bluebird from 'bluebird'
import type FormData from 'form-data'
import type adbutil from '../util/adbutil.js'
import type zmqutil from '../util/zmqutil.js'
import type protobuf from '../wire/protobuf.js'
import type ChannelManager from '../wire/channelmanager.js'
import type wirerouter from '../wire/router.js'

export interface DeviceOptions {
  serial: string
  provider: string
  publicIp: string
  endpoints: {
    sub: string[]
    push: string[]
  }
  groupTimeout: number
  storageUrl: string
  adbHost: string
  adbPort: number
  screenFrameRate: number
  screenJpegQuality: number
  screenGrabber: string
  screenPingInterval: number
  screenPort: number
  screenWsUrlPattern: string
  connectUrlPattern: string
  connectPort: number
  vncPort: number
  vncInitialSize: number[]
  heartbeatInterval: number
  bootCompleteTimeout: number
  muteMaster: 'always' | 'inuse' | 'never'
  lockRotation?: boolean
  cleanup: boolean
  cleanupDisableBluetooth: boolean
  cleanupBluetoothBonds: boolean
  cleanupFolder: string[]
  screenReset: boolean
}

export type Adb = ReturnType<typeof adbutil>

export type ZmqSocket = ReturnType<typeof zmqutil.socket>

export type Push = ZmqSocket

export type Sub = ZmqSocket

export type Channels = ChannelManager

export type Router = ReturnType<typeof wirerouter>

export type Properties = AdbProperties

export interface Abi {
  primary: string
  pie: boolean
  all: string[]
  b32: string[]
  b64: string[]
}

export interface Sdk {
  level: number
  previewDelta: number
  previewLevel: number
  release: string
}

export interface StoredFile {
  date: string
  plugin: string
  id: string
  name: string
  href: string
}

export interface Storage {
  store(
    type: string
  , stream: Readable
  , meta: FormData.AppendOptions
  ): Bluebird<StoredFile>
}

export interface Minicap {
  bin: string
  lib: string
  apk: string
  run(mode: string, cmd: string): Bluebird<Duplex>
}

export interface Minitouch {
  bin: string
  run(cmd?: string): Bluebird<Duplex>
}

export interface Minirev {
  bin: string
}

type ProtobufExport = ReturnType<typeof protobuf.build>

export type ProtobufMessageClass = Extract<
  ProtobufExport[string]
, {decode(buffer: Uint8Array): unknown}
>

export type ProtobufEnum = {[name: string]: number}

export type StfServiceEnumName =
  'MessageType'
| 'ClipboardType'
| 'RingerMode'
| 'KeyEvent'

export type StfServiceMessageName =
  'Envelope'
| 'AirplaneModeEvent'
| 'BatteryEvent'
| 'BrowserApp'
| 'BrowserPackageEvent'
| 'ConnectivityEvent'
| 'PhoneStateEvent'
| 'RotationEvent'
| 'GetVersionRequest'
| 'GetVersionResponse'
| 'SetKeyguardStateRequest'
| 'SetKeyguardStateResponse'
| 'SetWakeLockRequest'
| 'SetWakeLockResponse'
| 'SetClipboardRequest'
| 'SetClipboardResponse'
| 'GetClipboardRequest'
| 'GetClipboardResponse'
| 'GetBrowsersRequest'
| 'GetBrowsersResponse'
| 'GetDisplayRequest'
| 'GetDisplayResponse'
| 'Property'
| 'GetPropertiesRequest'
| 'GetPropertiesResponse'
| 'DoIdentifyRequest'
| 'DoIdentifyResponse'
| 'GetAccountsRequest'
| 'GetAccountsResponse'
| 'DoAddAccountMenuRequest'
| 'DoAddAccountMenuResponse'
| 'DoRemoveAccountRequest'
| 'DoRemoveAccountResponse'
| 'SetRingerModeRequest'
| 'SetRingerModeResponse'
| 'GetRingerModeRequest'
| 'GetRingerModeResponse'
| 'SetWifiEnabledRequest'
| 'SetWifiEnabledResponse'
| 'GetWifiStatusRequest'
| 'GetWifiStatusResponse'
| 'GetRootStatusRequest'
| 'GetRootStatusResponse'
| 'SetBluetoothEnabledRequest'
| 'SetBluetoothEnabledResponse'
| 'GetBluetoothStatusRequest'
| 'GetBluetoothStatusResponse'
| 'DoCleanBluetoothBondedDevicesRequest'
| 'DoCleanBluetoothBondedDevicesResponse'
| 'GetSdStatusRequest'
| 'GetSdStatusResponse'
| 'SetMasterMuteRequest'
| 'SetMasterMuteResponse'
| 'KeyEventRequest'
| 'DoTypeRequest'
| 'SetRotationRequest'
| 'DoWakeRequest'

export type StfServiceWire =
  Record<StfServiceMessageName, ProtobufMessageClass> &
  Record<StfServiceEnumName, ProtobufEnum>

export interface StfServiceProtoRoot {
  jp: {co: {cyberagent: {stf: {proto: StfServiceWire}}}}
}

export interface StfService {
  requiredVersion: string
  pkg: string
  main: string
  apk: string
  wire: StfServiceWire
  builder: ReturnType<typeof protobuf.load>
  startIntent: {
    action: string
    component: string
  }
  path: string
}
