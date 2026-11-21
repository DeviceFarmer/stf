import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import _ from 'lodash'
import yaml from 'js-yaml'
import ZSchema from 'z-schema'
import datautil from '../../../lib/util/datautil.js'
import type {DeviceDocument} from '../../../lib/types/stf.js'

// sway ships no types
const sway = createRequire(import.meta.url)('autodesk-forks-sway') as {
  create: (options: {definition: string}) => Promise<{
    validate: () => {errors: unknown[], warnings: unknown[]}
  }>
}

type Schema = Record<string, unknown>

const spec = yaml.load(fs.readFileSync(
  new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)
, 'utf8'
)) as {definitions: Record<string, Schema>}

// Swagger 2.0 has no null type. Read x-nullable the way client generators do.
function nullable(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(nullable)
  }
  if (!schema || typeof schema !== 'object') {
    return schema
  }
  const copy: Schema = {}
  for (const [key, value] of Object.entries(schema)) {
    copy[key] = nullable(value)
  }
  if (copy['x-nullable'] === true && typeof copy.type === 'string') {
    copy.type = [copy.type, 'null']
    if (Array.isArray(copy.enum)) {
      copy.enum = [...copy.enum, null]
    }
  }
  return copy
}

const definitions = nullable(spec.definitions) as Record<string, Schema>

// assumeAdditional rejects properties the schema does not list, so a field the API returns
// but the spec does not document fails the test.
function validate(body: unknown, definition: string) {
  const validator = new ZSchema({breakOnFirstError: false, assumeAdditional: true})
  const schema = {definitions, $ref: `#/definitions/${definition}`}
  const valid = validator.validate(JSON.parse(JSON.stringify(body)), schema)
  assert.equal(valid, true, JSON.stringify(validator.getLastErrors(), null, 2))
}

const viewer = {email: 'alice@example.com', privilege: 'user'}
const date = new Date('2026-11-20T10:00:00.000Z')

function androidDevice(): DeviceDocument {
  return {
    serial: '9a8b7c6d'
  , present: true
  , presenceChangedAt: date
  , ready: true
  , status: 3
  , statusChangedAt: date
  , statusTimeStamp: 1763632800000.123
  , channel: 'aGVsbG8gd29ybGQ='
  , owner: {email: viewer.email, name: 'Alice', group: 'aGVsbG8=', reservationId: 'r1'}
  , usage: 'automation'
  , usageChangedAt: date
  , automationLeaseId: 'lease-1'
  , automationRelease: {email: viewer.email, leaseId: 'lease-0'}
  , pendingOwnerReleases: []
  , lastOwnerRelease: null
  , restoreOwner: {email: viewer.email, usage: null, expiresAt: date.getTime()}
  , group: {
      id: 'g1', name: 'Common', class: 'bookable', repetitions: 0, origin: 'g1'
    , originName: 'Common', lock: false, owner: {email: 'admin@example.com', name: 'Admin'}
    , lifeTime: {start: date, stop: date}
    }
  , provider: {name: 'host-1', channel: 'cHJvdmlkZXI='}
  , createdAt: date
  , remoteConnect: true
  , remoteConnectUrl: 'stf.example.org:7401'
  , reverseForwards: [{id: 'f1', devicePort: 8080, targetHost: 'localhost', targetPort: 3000}]
  , logs_enabled: false
  , notes: 'Rack 2'
  , platform: 'Android'
  , manufacturer: 'Xiaomi'
  , model: 'Mi A2'
  , product: 'jasmine'
  , marketName: null
  , releasedAt: null
  , version: '15'
  , sdk: '35'
  , abi: 'arm64-v8a'
  , cpuPlatform: 'sdm660'
  , openGLESVersion: '3.0'
  , operator: null
  , cpu: {name: null, cores: 8, freq: null}
  , memory: {ram: 2048, rom: null}
  , display: {
      id: 0, width: 1080, height: 2400, rotation: 0, xdpi: 420, ydpi: 420, fps: 60
    , density: 2.625, secure: true, url: 'ws://stf.example.org/d/host-1/9a8b7c6d/7400/'
    , size: 6.3
    }
  , phone: {imei: null, imsi: null, phoneNumber: null, iccid: null, network: 'LTE'}
  , battery: {
      status: 'charging', health: 'good', source: 'ac', level: 100, scale: 100, temp: 25
    , voltage: 5
    }
  , network: {
      connected: true, type: 'wifi', subtype: null, failover: false, roaming: false
    , state: 'in_service', manual: false, operator: null
    }
  , airplaneMode: false
  , browser: {
      selected: true
    , apps: [{
        id: 'com.android.chrome/com.google.android.apps.chrome.Main', type: 'chrome'
      , name: 'Chrome', selected: true, system: true
      }]
    }
  }
}

// What IosBridge sends: no product, CPU, memory, GL, display size or Android-only blocks.
function iosDevice(): DeviceDocument {
  return {
    serial: '00008110-000000000000001E'
  , present: true
  , presenceChangedAt: date
  , ready: true
  , status: 3
  , statusChangedAt: date
  , statusTimeStamp: 1763632800000.123
  , channel: 'aGVsbG8gd29ybGQ='
  , owner: null
  , usage: null
  , automationLeaseId: null
  , pendingOwnerReleases: []
  , lastOwnerRelease: null
  , group: androidDevice().group
  , provider: {name: 'ios-host-1', channel: 'aW9zLXByb3ZpZGVy'}
  , createdAt: date
  , remoteConnect: false
  , remoteConnectUrl: null
  , reverseForwards: []
  , logs_enabled: false
  , platform: 'iOS'
  , manufacturer: 'Apple'
  , model: 'iPhone14,2'
  , marketName: 'iPhone 13 Pro'
  , version: '17.5'
  , sdk: '17.5'
  , abi: 'arm64'
  , display: {
      id: 0, width: 1170, height: 2532, rotation: 0, xdpi: 0, ydpi: 0, fps: 0
    , density: 1, secure: true, url: 'ws://stf.example.org/d/ios-host-1/00008110-000000000000001E/7400/'
    }
  , phone: {imei: null, imsi: null, phoneNumber: null, iccid: null, network: null}
  , browser: {selected: false, apps: []}
  , ios: {
      phase: 'ready', reason: 'locked', attempts: 0, lastReadyAt: date.toISOString()
    , updatedAt: date.toISOString(), name: 'iPhone', locked: true
    , battery: {level: 80, charging: false, externalPower: false, full: false}
    , storage: {total: 256000000000, free: 123456789012}
    , telemetryAt: date.toISOString()
    , wda: {
        installed: true, bundleId: 'com.facebook.WebDriverAgentRunner.xctrunner'
      , version: null, profile: 'valid', expiresAt: date.toISOString(), checkedAt: null
      }
    }
  }
}

function publish(device: DeviceDocument) {
  datautil.normalize(device, viewer)
  return device
}

describe('API Device schema', function() {
  it('is a valid Swagger document without unused definitions or broken $refs', async function() {
    const api = await sway.create({
      definition: new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url).pathname
    })
    const result = api.validate()
    assert.deepEqual([result.errors, result.warnings], [[], []])
  })

  it('documents every field of a normalized Android device', function() {
    const device = publish(androidDevice())
    assert.equal((device as datautil.Device).using, true)
    assert.ok((device as datautil.Device).name)
    validate(device, 'Device')
    validate({success: true, description: 'Device Information', device}, 'DeviceResponse')
  })

  it('accepts the nulls of an absent device and of a device held by someone else', function() {
    const absent = {...androidDevice(), present: false}
    const other = {...androidDevice(), owner: {email: 'bob@example.com', name: 'Bob', group: 'b'}}
    const devices = [publish(absent), publish(other), publish(iosDevice())]
    assert.equal(devices[0]!.owner, null)
    assert.equal(devices[1]!.remoteConnectUrl, null)
    validate({success: true, description: 'Devices Information', devices}, 'DeviceListResponse')
  })

  it('documents the ios status of an iPhone', function() {
    validate(publish(iosDevice()), 'Device')
  })

  it('accepts a fields= subset and an empty device', function() {
    const picked = _.pick(publish(androidDevice()), ['serial', 'present', 'owner', 'claimed'])
    validate({success: true, description: 'Device Information', device: picked}, 'DeviceResponse')
    validate({success: true, description: 'Unchanged (device)', device: {}}, 'DeviceResponse')
  })

  it('rejects a field the spec does not document', function() {
    assert.throws(() => validate({...publish(androidDevice()), surprise: 1}, 'Device'))
  })
})
