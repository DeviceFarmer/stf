import {createHash} from 'node:crypto'

export interface IosDeviceConfig {
  udid: string
  wdaBundleId: string
  name?: string
}

export interface IosConfig {
  publicOrigin: string
  devices: IosDeviceConfig[]
  android: boolean
}

export function iosDeviceId(udid: string): string {
  return 'ios-' + createHash('sha256').update(udid.toLowerCase()).digest('hex').slice(0, 12)
}

export function parseIosConfig(input: unknown): IosConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('An iOS configuration object is required')
  }
  const config = input as Record<string, unknown>
  const allowed = new Set(['publicOrigin', 'wdaBundleId', 'devices', 'android'])
  if (Object.keys(config).some(key => !allowed.has(key))) {
    throw new Error('Unknown iOS configuration option')
  }
  if (typeof config.publicOrigin !== 'string') {
    throw new Error('publicOrigin is required, for example http://localhost:7100')
  }
  const origin = new URL(config.publicOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.publicOrigin ||
      origin.username || origin.password) {
    throw new Error('publicOrigin must be an HTTP(S) origin without a path or credentials')
  }
  if (config.android !== undefined && typeof config.android !== 'boolean') {
    throw new Error('android must be a boolean')
  }
  if (!Array.isArray(config.devices) || !config.devices.length || config.devices.length > 32) {
    throw new Error('Select between 1 and 32 iPhones in devices')
  }
  const udids = new Set<string>()
  const devices = config.devices.map((item: unknown): IosDeviceConfig => {
    if (!item || typeof item !== 'object') {
      throw new Error('Each device must be an object with a udid')
    }
    const device = item as Record<string, unknown>
    if (Object.keys(device).some(key => !['udid', 'wdaBundleId', 'name'].includes(key))) {
      throw new Error('Unknown iOS device option')
    }
    const bundle = device.wdaBundleId ?? config.wdaBundleId
    if (typeof device.udid !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(device.udid) ||
        udids.has(device.udid.toLowerCase())) {
      throw new Error('Device udid is invalid or duplicated')
    }
    if (typeof bundle !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(bundle) ||
        bundle.length > 255) {
      throw new Error('Set wdaBundleId to the installed signed WDA runner identifier')
    }
    if (device.name !== undefined && (typeof device.name !== 'string' ||
        !device.name.trim() || device.name.length > 255 ||
        [...device.name].some(character => character.charCodeAt(0) < 32))) {
      throw new Error('Device name must be a nonempty single-line string')
    }
    udids.add(device.udid.toLowerCase())
    return {udid: device.udid, wdaBundleId: bundle
      , ...(typeof device.name === 'string' ? {name: device.name} : {})}
  })
  return {publicOrigin: origin.origin, devices, android: config.android === true}
}
