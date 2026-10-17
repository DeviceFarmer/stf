import {decodeIosDeviceStatus, type IosDeviceStatus} from '../../lib/util/ios-device-status.ts'
import type {RuntimeOptions} from './runtime.mts'
import {runJson} from './process.mts'
import fs from 'node:fs/promises'
import path from 'node:path'

export function profileStatus(
  profiles: unknown, bundleId: string, udid: string, now = Date.now()
): Pick<IosDeviceStatus['wda'], 'profile' | 'expiresAt'> {
  if (!Array.isArray(profiles)) {
    return {profile: 'unknown', expiresAt: null}
  }
  const matching = profiles.filter(p => {
    const id = p?.Entitlements?.['application-identifier']
    return typeof id === 'string' && id.slice(id.indexOf('.') + 1) === bundleId &&
      (p.ProvisionsAllDevices === true ||
        (Array.isArray(p.ProvisionedDevices) && p.ProvisionedDevices.includes(udid)))
  })
  const dates = matching.map(p => {
    const value = p.ExpirationDate
    return typeof value === 'string' ? Date.parse(/[Zz]|[+-]\d\d:\d\d$/.test(value) ?
      value : value + 'Z') : NaN
  }).filter(Number.isFinite)
  if (!matching.length) {
    return {profile: 'missing', expiresAt: null}
  }
  if (dates.length !== matching.length) {
    return {profile: 'unknown', expiresAt: null}
  }
  // Multiple matching profiles do not identify which one signed the installed app.
  const expires = Math.min(...dates)
  let profile: IosDeviceStatus['wda']['profile'] = 'valid'
  if (matching.length > 1) {
    profile = 'ambiguous'
  }
  else if (expires <= now) {
    profile = 'expired'
  }
  else if (expires - now <= 48 * 3600000) {
    profile = 'expiring'
  }
  return {profile, expiresAt: new Date(expires).toISOString()}
}

export function diagnosticReason(phase: string, error: unknown): string {
  const message = String(error)
  if (/developer.?mode/i.test(message)) {
    return 'developer_mode_required'
  }
  if (/pair|trust|InvalidHostID|UserDenied/i.test(message)) {
    return 'trust_required'
  }
  if (/locked|passcode|password.?protected|ServiceProhibited/i.test(message)) {
    return 'locked'
  }
  if (message.includes('IOS_WDA_MISSING')) {
    return 'wda_missing'
  }
  if (phase === 'checking_usb') {
    return 'disconnected'
  }
  if (phase === 'tunnel') {
    return 'tunnel_unavailable'
  }
  if (phase === 'mounting') {
    return 'image_mount_failed'
  }
  return 'wda_unavailable'
}

export class Telemetry {
  readonly status: IosDeviceStatus
  private lastProfileCheck = 0
  private options: RuntimeOptions
  private json: typeof runJson

  constructor(options: RuntimeOptions, json = runJson) {
    this.options = options
    this.json = json
    this.status = {phase: 'checking_usb', reason: 'recovering', attempts: 0, lastReadyAt: null
      , updatedAt: new Date().toISOString(), name: null, locked: null, battery: null, storage: null
      , telemetryAt: null, wda: {installed: null, bundleId: options.bundleId, version: null
        , profile: 'unknown', expiresAt: null, checkedAt: null}}
  }

  phase(phase: string, reason = 'recovering') {
    this.clock()
    Object.assign(this.status, {phase, reason, updatedAt: new Date().toISOString()})
  }

  private clock() {
    const wda = this.status.wda
    if (wda.expiresAt && ['valid', 'expiring', 'expired'].includes(wda.profile)) {
      const remaining = Date.parse(wda.expiresAt) - Date.now()
      wda.profile = 'valid'
      if (remaining <= 48 * 3600000) {
        wda.profile = 'expiring'
      }
      if (remaining <= 0) {
        wda.profile = 'expired'
      }
    }
  }

  async load() {
    if (!this.options.stateDirectory) {
      return
    }
    try {
      const file = path.join(this.options.stateDirectory, 'device.json')
      if ((await fs.stat(file)).size > 16384) {
        return
      }
      const cache = JSON.parse(await fs.readFile(file, 'utf8'))
      const status = decodeIosDeviceStatus(JSON.stringify(cache.ios))
      if (cache.udid === this.options.udid && cache.bundleId === this.options.bundleId &&
          status?.wda.bundleId === this.options.bundleId) {
        Object.assign(this.status, status)
        this.phase('checking_usb')
      }
    }
    catch {
      // Missing/corrupt metadata must not prevent reconnecting the selected device.
    }
  }

  private async save() {
    if (!this.options.stateDirectory) {
      return
    }
    try {
      await fs.mkdir(this.options.stateDirectory, {recursive: true, mode: 0o700})
      const file = path.join(this.options.stateDirectory, 'device.json')
      await fs.writeFile(file + '.tmp', JSON.stringify({udid: this.options.udid
        , bundleId: this.options.bundleId, ios: this.status}), {mode: 0o600})
      await fs.rename(file + '.tmp', file)
    }
    catch {
      process.stderr.write('Could not persist iPhone telemetry\n')
    }
  }

  async refresh(signal: AbortSignal, force = false) {
    const o = this.options
    const args = ['--udid=' + o.udid, '--tunnel-info-port=' + o.tunnelPort]
    const commands = [
      this.json(o.goIos, [...args, 'batterycheck'], 10000, signal)
    , this.json(o.goIos, [...args, 'diskspace'], 10000, signal)
    ]
    const profiles = force || Date.now() - this.lastProfileCheck > 1800000
    if (profiles) {
      commands.push(this.json(o.goIos, [...args, 'apps'], 10000, signal))
      commands.push(this.json(o.pymobiledevice3, ['provision', 'list', '--udid=' + o.udid],
        15000, signal))
    }
    const values = await Promise.allSettled(commands)
    const data = values.map(result => result.status === 'fulfilled' ? result.value as any : null)
    const [battery, disk, apps, provisions] = data
    const batteryValid = battery && Number.isFinite(battery.BatteryCurrentCapacity) &&
      battery.BatteryCurrentCapacity >= 0 && battery.BatteryCurrentCapacity <= 100
    const diskValid = disk && Number.isFinite(disk.TotalBytes) && Number.isFinite(disk.FreeBytes) &&
      disk.TotalBytes > 0 && disk.FreeBytes >= 0 && disk.FreeBytes <= disk.TotalBytes
    if (batteryValid) {
      this.status.battery = {level: battery.BatteryCurrentCapacity
        , charging: battery.BatteryIsCharging === true
        , externalPower: battery.ExternalConnected === true
        , full: battery.FullyCharged === true}
    }
    if (diskValid) {
      this.status.storage = {total: disk.TotalBytes, free: disk.FreeBytes}
    }
    if (batteryValid && diskValid) {
      this.status.telemetryAt = new Date().toISOString()
    }
    if (profiles) {
      if (Array.isArray(apps)) {
        const app = apps.find(app => app.CFBundleIdentifier === o.bundleId)
        this.status.wda.installed = Boolean(app)
        this.status.wda.version = app?.CFBundleShortVersionString || null
      }
      if (Array.isArray(provisions)) {
        Object.assign(this.status.wda, profileStatus(provisions, o.bundleId, o.udid)
          , {checkedAt: new Date().toISOString()})
      }
      this.lastProfileCheck = Date.now()
    }
    this.clock()
    await this.save()
  }
}
