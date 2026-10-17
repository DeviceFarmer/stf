import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, it} from 'node:test'
import {Telemetry, diagnosticReason, profileStatus} from '../telemetry.mts'
import type {RuntimeOptions} from '../runtime.mts'

const selected = 'selected-iphone'
const bundle = 'test.wda.xctrunner'
const now = Date.parse('2026-10-16T12:00:00Z')
const profile = (expires: string, id = selected) => ({
  Entitlements: {'application-identifier': 'TEAM.' + bundle}, ExpirationDate: expires
  , ProvisionedDevices: [id]
})
const options = {udid: selected, bundleId: bundle, goIos: 'ios', pymobiledevice3: 'pymd'
  , tunnelPort: 28100} as RuntimeOptions
const directories: string[] = []
afterEach(async() => {
  await Promise.all(directories.splice(0).map(directory =>
    fs.rm(directory, {recursive: true, force: true})))
})

describe('iPhone diagnostics and WDA profiles', () => {
  it('matches the selected runner and device and normalizes UTC profile dates', () => {
    const result = profileStatus([profile('2026-10-22T16:07:26')
      , profile('2026-10-25T12:00:00Z', 'different-iphone')], bundle, selected, now)
    assert.deepEqual(result, {profile: 'valid', expiresAt: '2026-10-22T16:07:26.000Z'})
  })

  it('distinguishes expiry, advance warning, unknown and ambiguous profiles', () => {
    assert.equal(profileStatus([profile('2026-10-15T12:00:00Z')], bundle, selected, now).profile,
      'expired')
    assert.equal(profileStatus([profile('2026-10-17T12:00:00Z')], bundle, selected, now).profile,
      'expiring')
    assert.equal(profileStatus([], bundle, selected, now).profile, 'missing')
    assert.equal(profileStatus(null, bundle, selected, now).profile, 'unknown')
    assert.equal(profileStatus([profile('not-a-date')], bundle, selected, now).profile, 'unknown')
    assert.equal(profileStatus([{...profile('2099-01-01'), ProvisionedDevices: selected}],
      bundle, selected, now).profile, 'missing')
    const ambiguous = profileStatus([profile('2026-10-17T12:00:00Z')
      , profile('2026-10-20T12:00:00Z')], bundle, selected, now)
    assert.equal(ambiguous.profile, 'ambiguous')
    assert.equal(ambiguous.expiresAt, '2026-10-17T12:00:00.000Z')
  })

  it('reports actionable failure reasons without exposing raw subprocess messages', () => {
    assert.equal(diagnosticReason('checking_usb', 'iPhone is not connected'), 'disconnected')
    assert.equal(diagnosticReason('pairing', 'InvalidHostID'), 'trust_required')
    assert.equal(diagnosticReason('session', 'DeviceLocked'), 'locked')
    assert.equal(diagnosticReason('mounting', 'DeveloperModeDisabled'), 'developer_mode_required')
    assert.equal(diagnosticReason('wda', 'IOS_WDA_MISSING'), 'wda_missing')
    assert.equal(diagnosticReason('tunnel', 'failed'), 'tunnel_unavailable')
    assert.equal(diagnosticReason('mounting', 'failed'), 'image_mount_failed')
    assert.equal(diagnosticReason('wda', 'failed /private/path'), 'wda_unavailable')
  })

  it('selects a UDID and distinguishes power from charging', async() => {
    const calls: string[][] = []
    const telemetry = new Telemetry(options, async(binary, args) => {
      calls.push([binary, ...args])
      if (args.includes('batterycheck')) {
        return {BatteryCurrentCapacity: 100, BatteryIsCharging: false
          , ExternalConnected: true, FullyCharged: true}
      }
      if (args.includes('diskspace')) {
        return {TotalBytes: 128000, FreeBytes: 96000}
      }
      if (args.includes('apps')) {
        return [{CFBundleIdentifier: bundle, CFBundleShortVersionString: '16.15.0'}]
      }
      return [profile('2099-01-01T00:00:00Z')]
    })
    await telemetry.refresh(new AbortController().signal)
    assert.ok(calls.every(args => args.includes('--udid=' + selected)))
    assert.deepEqual(telemetry.status.battery,
      {level: 100, charging: false, externalPower: true, full: true})
    assert.deepEqual(telemetry.status.storage, {total: 128000, free: 96000})
    assert.equal(telemetry.status.wda.installed, true)
    assert.equal(telemetry.status.wda.profile, 'valid')
    assert.equal(telemetry.status.wda.version, '16.15.0')
  })

  it('keeps last-known data and timestamps when services become unavailable', async() => {
    let fail = false
    const telemetry = new Telemetry(options, async(_binary, args) => {
      if (fail) {
        throw new Error('Device disconnected')
      }
      if (args.includes('batterycheck')) {
        return {BatteryCurrentCapacity: 40}
      }
      if (args.includes('diskspace')) {
        return {TotalBytes: 100, FreeBytes: 20}
      }
      if (args.includes('apps')) {
        return [{CFBundleIdentifier: bundle}]
      }
      return [profile('2099-01-01T00:00:00Z')]
    })
    await telemetry.refresh(new AbortController().signal, true)
    const before = structuredClone(telemetry.status)
    fail = true
    await telemetry.refresh(new AbortController().signal, true)
    assert.deepEqual(telemetry.status.battery, before.battery)
    assert.equal(telemetry.status.telemetryAt, before.telemetryAt)
    assert.equal(telemetry.status.wda.checkedAt, before.wda.checkedAt)
    assert.equal(telemetry.status.wda.expiresAt, before.wda.expiresAt)
  })

  it('restores metadata after restart only for the same UDID and runner', async() => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ios-telemetry-'))
    directories.push(directory)
    const first = new Telemetry({...options, stateDirectory: directory}, async() => null)
    first.status.wda.expiresAt = '2099-01-01T00:00:00.000Z'
    first.status.wda.profile = 'valid'
    first.status.name = 'Lab iPhone'
    await first.refresh(new AbortController().signal)
    const second = new Telemetry({...options, stateDirectory: directory})
    await second.load()
    assert.equal(second.status.name, 'Lab iPhone')
    assert.equal(second.status.wda.expiresAt, '2099-01-01T00:00:00.000Z')
    assert.equal(second.status.phase, 'checking_usb')
    const foreign = new Telemetry({...options, udid: 'another-phone', stateDirectory: directory})
    await foreign.load()
    assert.equal(foreign.status.wda.expiresAt, null)
    assert.equal((await fs.stat(path.join(directory, 'device.json'))).mode & 0o777, 0o600)
  })
})
