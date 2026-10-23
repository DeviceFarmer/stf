import assert from 'node:assert/strict'
import {decodeIosDeviceStatus, readIosProperties} from '../../lib/util/ios-device-status.js'

const status = {phase: 'ready', reason: 'ready', attempts: 1, lastReadyAt: null
  , updatedAt: '2026-10-16T12:00:00Z', name: 'Lab iPhone', locked: false
  , battery: {level: 100, charging: false, externalPower: true, full: true}
  , storage: {total: 100, free: 20}, telemetryAt: null
  , wda: {installed: true, bundleId: 'test.wda.xctrunner', version: '16.15.0'
    , profile: 'valid', expiresAt: '2026-10-22T12:00:00Z', checkedAt: null}}

describe('iOS health wire properties', () => {
  it('decodes only the reserved property and drops arbitrary fields', () => {
    assert.deepEqual(readIosProperties([{name: 'stf.ios.status'
      , value: JSON.stringify({...status, untrusted: 'discard'})}]), status)
    assert.equal(readIosProperties([{name: 'other', value: JSON.stringify(status)}]), null)
  })
  it('rejects malformed telemetry before database and UI propagation', () => {
    for (const value of [null, {}, {...status, phase: '<script>'}, {...status, updatedAt: 'bad'}
      , {...status, battery: {...status.battery, level: 101}}
      , {...status, storage: {total: 10, free: 20}}
      , {...status, wda: {...status.wda, profile: 'arbitrary'}}]) {
      assert.equal(decodeIosDeviceStatus(JSON.stringify(value)), null)
    }
    assert.equal(decodeIosDeviceStatus('x'.repeat(8193)), null)
  })
})
