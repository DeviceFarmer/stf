import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import Bluebird from 'bluebird'
import sinon from 'sinon'
import type {Response} from 'express'
import type {ApiRequest} from '../../lib/types/units-api.js'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

const loadDevice = sinon.stub()
const restoreDb = mockModule(new URL('../../lib/db/api.js', import.meta.url), {
  default: {loadDevice}
})
const restoreAdb = mockModule(new URL('../../lib/util/adbutil.js', import.meta.url), {
  default: () => ({})
})
const restoreLocks = mockModule(new URL('../../lib/util/lockutil.js', import.meta.url), {
  default: {}
})
let deleteUserDeviceBySerial: (req: ApiRequest, res: Response) => void
try {
  const controller = await importFresh(
    new URL('../../lib/units/api/controllers/user.js', import.meta.url)
  )
  deleteUserDeviceBySerial = controller.deleteUserDeviceBySerial
}
finally {
  restoreLocks()
  restoreAdb()
  restoreDb()
}

const owner = {email: 'runner@example.test', name: 'Runner', group: 'runner-group'
  , reservationId: 'reservation-one'}

function fixture(privilege = 'admin', expected: Record<string, string> = {
  reservationId: owner.reservationId, deviceChannel: 'runtime-one'
}) {
  const channelRouter = new EventEmitter()
  const push = {send: sinon.spy()}
  const device = {serial: 'device', present: true, ready: true
    , owner: {...owner}, channel: 'runtime-one', usage: 'automation'}
  loadDevice.reset()
  loadDevice.returns(Bluebird.resolve({next: (callback: Function) => callback(null, device)}))
  let resolveResponse!: () => void
  const responded = new Promise<void>(resolve => {
    resolveResponse = resolve
  })
  const response = {statusCode: 200, body: null as any
    , status(code: number) {
      this.statusCode = code
      return this
    }
    , json(body: unknown) {
      this.body = body
      resolveResponse()
      return this
    }
  }
  const req = {swagger: {params: {serial: {value: 'device'}
    , ...Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, {value}]))}}
    , user: {email: 'admin@example.test', privilege, groups: {subscribed: ['visible-group']}}
    , options: {channelRouter, push}}
  const release = () => deleteUserDeviceBySerial(req as unknown as ApiRequest,
    response as unknown as Response)
  function left(reservationId = owner.reservationId) {
    channelRouter.emit(wireutil.global, Buffer.from(wireutil.global), wireutil.envelope(
      new wire.LeaveGroupMessage('device', {...owner, reservationId}, 'ungroup_request')
    ))
  }
  return {release, responded, response, req, device, push, left, channelRouter}
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); ++i) {
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  assert.ok(check(), 'Expected request to progress')
}

describe('conditional device release API', function() {
  it('keeps group-scoped lookup and admin release, fencing the provider request', async function() {
    const f = fixture()
    f.release()
    await until(() => f.push.send.calledOnce)
    assert.deepEqual(loadDevice.firstCall.args, [['visible-group'], 'device'])
    const [channel, bytes] = f.push.send.firstCall.args[0]
    assert.equal(channel, 'runtime-one')
    const envelope = wire.Envelope.decode(bytes)
    const message = wire.UngroupMessage.decode(envelope.message)
    assert.equal(message.reservationId, owner.reservationId)
    assert.equal(message.requirements[0]?.value, 'device')
    f.left('new-reservation')
    assert.equal(f.response.body, null, 'An unrelated leave must not acknowledge this release')
    f.left()
    await f.responded
    assert.equal(f.response.statusCode, 200)
    assert.equal(f.channelRouter.listenerCount(wireutil.global), 0)
  })

  for (const changed of ['reservation', 'runtime'] as const) {
    it('rejects a changed ' + changed + ' before sending any command', async function() {
      const f = fixture()
      if (changed === 'reservation') {
        f.device.owner.reservationId = 'new-reservation'
      }
      else {
        f.device.channel = 'new-runtime'
      }
      f.release()
      await f.responded
      assert.equal(f.response.statusCode, 409)
      assert.equal(f.push.send.called, false)
    })
  }

  it('does not grant an ordinary viewer administrative release', async function() {
    const f = fixture('user')
    f.release()
    await f.responded
    assert.equal(f.response.statusCode, 403)
    assert.equal(f.push.send.called, false)
  })

  it('does not expose a device outside subscribed groups', async function() {
    const f = fixture()
    loadDevice.returns(Bluebird.resolve({
      next: (callback: Function) => callback(new Error('missing'))
    }))
    f.release()
    await f.responded
    assert.equal(f.response.statusCode, 404)
    assert.equal(f.push.send.called, false)
  })

  for (const field of ['reservationId', 'deviceChannel']) {
    it('requires both identity fields when only ' + field + ' is supplied', async function() {
      const f = fixture('admin', {[field]: 'one'})
      f.release()
      await f.responded
      assert.equal(f.response.statusCode, 400)
      assert.equal(loadDevice.called, false)
    })
  }

  it('preserves the existing unconditional API contract for older clients', async function() {
    const f = fixture('admin', {})
    f.release()
    await until(() => f.push.send.calledOnce)
    const envelope = wire.Envelope.decode(f.push.send.firstCall.args[0][1])
    assert.equal(wire.UngroupMessage.decode(envelope.message).reservationId, null)
    f.left()
    await f.responded
    assert.equal(f.response.statusCode, 200)
  })

  it('removes the listener on timeout and ignores a late leave', async function() {
    const f = fixture()
    const respond = sinon.spy(f.response, 'json')
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    try {
      f.release()
      // Let the DB promise run without advancing the response deadline.
      for (let i = 0; i < 100 && !f.push.send.called; ++i) {
        await new Promise(resolve => setImmediate(resolve))
      }
      assert.equal(f.push.send.calledOnce, true)
      assert.equal(f.channelRouter.listenerCount(wireutil.global), 1)
      await clock.tickAsync(5000)
      await f.responded
      assert.equal(f.response.statusCode, 504)
      assert.equal(f.channelRouter.listenerCount(wireutil.global), 0)
      f.left()
      assert.equal(respond.callCount, 1)
    }
    finally {
      clock.restore()
      respond.restore()
    }
  })
})
