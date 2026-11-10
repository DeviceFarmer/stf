import assert from 'node:assert/strict'
import events from 'node:events'
import Bluebird from 'bluebird'
import sinon from 'sinon'
import type {Response} from 'express'
import type {ApiRequest, AutomationLeaseBody} from '../../lib/types/units-api.js'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

let device: any
const loadDevice = sinon.spy(() => Bluebird.resolve({next(callback: any) {
  callback(device ? null : new Error('missing'), device && {...device})
}}))
const restoreMock = mockModule(new URL('../../lib/db/api.js', import.meta.url), {
  default: {loadDevice}
})
const {renewAutomationLease, releaseAutomationLease, deleteUserDeviceBySerial,
  getUserDeviceBySerial, rebootUserDeviceBySerial, remoteConnectUserDeviceBySerial,
  remoteDisconnectUserDeviceBySerial} =
  await importFresh(new URL('../../lib/units/api/controllers/user.js', import.meta.url))
restoreMock()
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

function fixture(body: AutomationLeaseBody = {leaseId: 'lease-a', timeout: 180000}) {
  const router = new events.EventEmitter()
  const sub = {subscribe: sinon.spy(), unsubscribe: sinon.spy()}
  const push = {send: sinon.spy()}
  const req = {
    body, swagger: {params: {serial: {value: 'device'}, fields: {value: ''}
      , keepOwnership: {value: false}}}
    , user: {email: 'runner@example.test', name: 'Runner', group: 'runner-group', privilege: 'user'
      , groups: {subscribed: ['group']}}
    , options: {channelRouter: router, sub, push}
  } as unknown as ApiRequest<AutomationLeaseBody>
  let status = 200
  let result: any = null
  const res = {status(code: number) {
    status = code
    return res
  }, json(value: unknown) {
    result = value
    return res
  }} as unknown as Response
  return {req, res, router, sub, push, status: () => status, result: () => result}
}

describe('Automation lease API', function() {
  beforeEach(function() {
    loadDevice.resetHistory()
    device = {serial: 'device', channel: 'device-channel', present: true, ready: true
      , owner: {email: 'runner@example.test'}, usage: 'automation', automationLeaseId: 'lease-a'}
  })

  it('waits for provider acknowledgment and returns the confirmed deadline', async function() {
    const f = fixture()
    renewAutomationLease(f.req, f.res)
    await flush()
    assert.equal(f.result(), null)
    assert.equal(f.push.send.callCount, 1)
    const envelope = wire.Envelope.decode(f.push.send.firstCall.args[0][1])
    const message = wire.AutomationLeaseMessage.decode(envelope.message)
    assert.equal(message.action, 'renew')
    assert.equal(message.leaseId, 'lease-a')
    assert.equal(message.timeout, 180000)
    assert.equal(message.owner.email, f.req.user.email)
    f.router.emit(envelope.channel!, envelope.channel!, wireutil.reply('device').okay(null,
      {expiresAt: 123456789}))
    assert.deepEqual(f.result(), {success: true, leaseId: 'lease-a', expiresAt: 123456789})
    assert.equal(f.sub.unsubscribe.callCount, 1)
    assert.equal(f.router.listenerCount(envelope.channel!), 0)
  })

  it('returns conflict when provider replaced the API snapshot lease', async function() {
    const f = fixture()
    releaseAutomationLease(f.req, f.res)
    await flush()
    const envelope = wire.Envelope.decode(f.push.send.firstCall.args[0][1])
    const message = wire.AutomationLeaseMessage.decode(envelope.message)
    assert.equal(message.action, 'release')
    f.router.emit(envelope.channel!, envelope.channel!,
      wireutil.reply('device').fail('Stale automation lease'))
    assert.equal(f.status(), 409)
    assert.equal(f.result().success, false)
  })

  it('rejects an old lease before dispatch and never sends an implicit capture', async function() {
    device.automationLeaseId = 'lease-b'
    const f = fixture()
    renewAutomationLease(f.req, f.res)
    await flush()
    assert.equal(f.status(), 409)
    assert.equal(f.push.send.callCount, 0)
  })

  it('returns conflict after a lease has already been released', async function() {
    device.owner = null
    device.automationLeaseId = null
    const f = fixture()
    releaseAutomationLease(f.req, f.res)
    await flush()
    assert.equal(f.status(), 409)
    assert.equal(f.push.send.callCount, 0)
  })

  it('rejects a nonowner including an administrator', async function() {
    const f = fixture()
    f.req.user.email = 'admin@example.test'
    f.req.user.privilege = 'admin'
    releaseAutomationLease(f.req, f.res)
    await flush()
    assert.equal(f.status(), 403)
    assert.equal(f.push.send.callCount, 0)
  })

  it('rejects invalid renewal durations before loading a device', function() {
    const f = fixture({leaseId: 'lease-a', timeout: 0})
    renewAutomationLease(f.req, f.res)
    assert.equal(f.status(), 400)
    assert.equal(loadDevice.callCount, 0)
  })

  it('refuses to renew legacy automation without a fence', async function() {
    device.automationLeaseId = null
    const f = fixture()
    renewAutomationLease(f.req, f.res)
    await flush()
    assert.equal(f.status(), 409)
    assert.equal(f.push.send.callCount, 0)
  })

  it('rejects legacy release of a coordinator lease before provider dispatch', async function() {
    const f = fixture()
    deleteUserDeviceBySerial(f.req, f.res)
    await flush()
    assert.equal(f.status(), 409)
    assert.match(f.result().description, /fenced automation release/)
    assert.equal(f.push.send.callCount, 0)
  })

  it('fences conditional owner and administrator release of a managed lease', async function() {
    for (const privilege of ['user', 'admin']) {
      device.owner.reservationId = 'current-reservation'
      const manual = fixture()
      manual.req.user.privilege = privilege
      if (privilege === 'admin') {
        manual.req.user.email = 'admin@example.test'
      }
      Object.assign(manual.req.swagger.params, {
        reservationId: {value: device.owner.reservationId}
        , deviceChannel: {value: device.channel}
      })
      deleteUserDeviceBySerial(manual.req, manual.res)
      await flush()
      assert.equal(manual.status(), 409)
      assert.match(manual.result().description, /fenced automation release/)
      assert.equal(manual.push.send.callCount, 0)
      assert.equal(device.automationLeaseId, 'lease-a')
      assert.equal(device.owner.reservationId, 'current-reservation')

      const fenced = fixture({leaseId: 'lease-a'})
      releaseAutomationLease(fenced.req, fenced.res)
      await flush()
      assert.equal(fenced.result(), null, 'Release must wait for the provider')
      assert.equal(fenced.push.send.callCount, 1)
      const envelope = wire.Envelope.decode(fenced.push.send.firstCall.args[0][1])
      const message = wire.AutomationLeaseMessage.decode(envelope.message)
      assert.equal(message.serial, 'device')
      assert.equal(message.owner.email, device.owner.email)
      assert.equal(message.leaseId, device.automationLeaseId)
      assert.equal(message.action, 'release')
      fenced.router.emit(envelope.channel!, envelope.channel!, wireutil.reply('device').okay())
      assert.equal(fenced.status(), 200)
      assert.deepEqual(fenced.result(), {success: true, leaseId: 'lease-a'})
      assert.equal(fenced.router.listenerCount(envelope.channel!), 0)
      assert.equal(fenced.sub.unsubscribe.callCount, 1)
    }
  })

  it('keeps legacy release available for an unfenced automation reservation', async function() {
    device.automationLeaseId = null
    const f = fixture()
    deleteUserDeviceBySerial(f.req, f.res)
    await flush()
    assert.equal(f.result(), null)
    assert.equal(f.push.send.callCount, 1)
    const envelope = wire.Envelope.decode(f.push.send.firstCall.args[0][1])
    assert.equal(envelope.type, wire.UngroupMessage.$code)
    f.router.emit(wireutil.global, wireutil.global, wireutil.envelope(new wire.LeaveGroupMessage(
      'device', new wire.OwnerMessage('runner@example.test', 'Runner', 'runner-group'),
      'ungroup_request'
    )))
    assert.equal(f.status(), 200)
    assert.equal(f.result().success, true)
  })

  it('blocks legacy reboot and remote connection changes for coordinator leases', async function() {
    for (const operation of [rebootUserDeviceBySerial, remoteConnectUserDeviceBySerial
      , remoteDisconnectUserDeviceBySerial]) {
      const f = fixture()
      operation(f.req, f.res)
      await flush()
      assert.equal(f.status(), 409)
      assert.equal(f.push.send.callCount, 0)
      assert.equal(f.sub.subscribe.callCount, 0)
    }
  })

  it('allows the owner to read a coordinator device without changing its lease', async function() {
    const f = fixture()
    getUserDeviceBySerial(f.req, f.res)
    await flush()
    assert.equal(f.status(), 200)
    assert.equal(f.result().device.automationLeaseId, 'lease-a')
    assert.equal(f.push.send.callCount, 0)
  })

  it('times out without pretending a provider acknowledged', async function() {
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    try {
      const f = fixture()
      releaseAutomationLease(f.req, f.res)
      await flush()
      clock.tick(90000)
      assert.equal(f.status(), 504)
      assert.equal(f.sub.unsubscribe.callCount, 1)
    }
    finally {
      clock.restore()
    }
  })
})
