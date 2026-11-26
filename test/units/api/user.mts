import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import type {Response} from 'express'
import sinon from 'sinon'
import ZSchema from 'z-schema'
import type {AddUserDeviceBody, ApiRequest} from '../../../lib/types/units-api.js'
import {iosScreenWakeFailed} from '../../../lib/util/automation-lease.js'
import wire from '../../../lib/wire/index.js'
import wireutil from '../../../lib/wire/util.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as {
  load: (content: string) => unknown
}

const captureDevice = {serial: 'phone', platform: 'iOS', channel: 'ios:phone'}
const captureOwner = new wire.OwnerMessage('runner@example.test', 'Runner', 'runner')
let unlocks = 0
let waitForLock = () => Promise.resolve()
let lookupReceipt = () => Promise.resolve(false)
let lockRefused = false

const restoreDb = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {
  default: {
    hasDeviceAutomationRelease: () => lookupReceipt()
  , async lockDeviceByCurrent() {
      await waitForLock()
      return lockRefused ? {replaced: 0, locked: true} :
        {replaced: 1, changes: [{new_val: {...captureDevice}}]}
    }
  , unlockDevice() {
      unlocks++
    }
  }
})
const restoreAdb = mockModule(new URL('../../../lib/util/adbutil.js', import.meta.url), {
  default: () => ({})
})
const locks = new URL('../../../lib/util/lockutil.js', import.meta.url)
const restoreLocks = mockModule(locks, {default: (await importFresh(locks)).default})
const restoreData = mockModule(new URL('../../../lib/util/datautil.js', import.meta.url), {
  default: {normalize() {}}
})
const restoreDevice = mockModule(new URL('../../../lib/util/deviceutil.js', import.meta.url), {
  default: {isAddable: () => true}
})

let getUser: (req: ApiRequest, res: Response) => void
, addUserDevice: (req: ApiRequest<AddUserDeviceBody>, res: Response) => void
try {
  const controller = await importFresh(
    new URL('../../../lib/units/api/controllers/user.js', import.meta.url)
  )
  getUser = controller.getUser
  addUserDevice = controller.addUserDevice
}
finally {
  restoreDevice()
  restoreData()
  restoreLocks()
  restoreAdb()
  restoreDb()
}

interface SwaggerSpec {
  definitions: {
    UserResponse: Record<string, unknown>
  }
}

interface UserResponseBody {
  success: boolean
  description: string
  user: unknown
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return {promise, resolve}
}

function beginCapture(leaseId: string, screenLifecycle?: boolean) {
  const channelRouter = new EventEmitter()
  const subscriptions = new Set<string>()
  const responses: {status: number, body: unknown}[] = []
  const dispatched: [string, Buffer][] = []
  let dispatch!: (message: [string, Buffer]) => void
  const sent = new Promise<[string, Buffer]>(resolve => {
    dispatch = resolve
  })
  const req = {
    body: {serial: captureDevice.serial, leaseId
      , ...(typeof screenLifecycle === 'boolean' ? {screenLifecycle} : {})}
  , user: {...captureOwner, groups: {subscribed: ['devices']}}
  , options: {channelRouter, automationLeaseAccounts: [captureOwner.email]
    , sub: {subscribe: (channel: string) => subscriptions.add(channel)
      , unsubscribe: (channel: string) => subscriptions.delete(channel)}
    , push: {send(message: [string, Buffer]) {
      dispatched.push(message)
      dispatch(message)
    }}}
  }
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, statusCode: 200
  , status(code: number) {
      this.statusCode = code
      return this
    }
  , json(body: unknown) {
      responses.push({status: this.statusCode, body})
    }
  })
  const before = unlocks
  addUserDevice(req as unknown as ApiRequest<AddUserDeviceBody>, res as unknown as Response)
  const assertDetached = () => {
    assert.equal(subscriptions.size, 0)
    assert.equal(channelRouter.eventNames().length, 0)
    assert.equal(res.listenerCount('close'), 0)
  }
  return {sent, responses, subscriptions, dispatched, assertDetached, close() {
    res.destroyed = true
    res.emit('close')
  }
    , reply(name: string, message: wireutil.Message) {
      channelRouter.emit(name, Buffer.from(name), wireutil.envelope(message))
    }, assertClean() {
      assert.equal(unlocks, before + 1)
      assertDetached()
    }}
}

async function startCapture(leaseId: string, screenLifecycle?: boolean) {
  const capture = beginCapture(leaseId, screenLifecycle)
  const [deviceChannel, message] = await capture.sent
  assert.equal(deviceChannel, captureDevice.channel)
  const envelope = wire.Envelope.decode(message)
  const group = wire.GroupMessage.decode(envelope.message)
  assert.equal(group.leaseId, leaseId)
  assert.equal(group.screenLifecycle === true, screenLifecycle === true)
  const channel = envelope.channel!
  assert.ok(capture.subscriptions.has(channel))
  return {...capture, channel}
}

describe('API user controller', function() {
  const swaggerYaml = fs.readFileSync(
    new URL('../../../lib/units/api/swagger/api_v1.yaml', import.meta.url)
  , 'utf8'
  )
  const spec = yaml.load(swaggerYaml) as SwaggerSpec
  const userResponseSchema = spec.definitions.UserResponse

  afterEach(() => {
    waitForLock = () => Promise.resolve()
    lookupReceipt = () => Promise.resolve(false)
    lockRefused = false
  })

  it('requires an authorized managed lease for screen lifecycle', function() {
    for (const [lease, expectedStatus] of [[{}, 400], [{leaseId: 'lease-id'}, 403]] as const) {
      const req = {body: {serial: 'phone', ...lease, screenLifecycle: true}
        , options: {automationLeaseAccounts: ['runner@example.test']}
        , user: {email: 'viewer@example.test'}}
      const res = {statusCode: 200, status(code: number) {
        this.statusCode = code
        return this
      }, json() {}}
      addUserDevice(req as unknown as ApiRequest<AddUserDeviceBody>, res as unknown as Response)
      assert.equal(res.statusCode, expectedStatus)
    }
  })

  it('accepts only a wake refusal from the captured phone on the private channel', async() => {
    const capture = await startCapture('lease-id', true)
    const reply = (source: string, success: boolean, data: string) =>
      new wire.TransactionDoneMessage(source, 0, success, data)
    capture.reply(wireutil.global, reply('phone', false, iosScreenWakeFailed))
    capture.reply(capture.channel, reply('other-phone', false, iosScreenWakeFailed))
    capture.reply(capture.channel, reply('phone', true, iosScreenWakeFailed))
    capture.reply(capture.channel, reply('phone', false, 'unknown error'))
    assert.equal(capture.responses.length, 0)

    capture.reply(capture.channel, reply('phone', false, iosScreenWakeFailed))
    assert.deepEqual(capture.responses, [{status: 409, body: {success: false
      , code: iosScreenWakeFailed, description: 'iPhone screen could not be unlocked'}}])
    capture.assertClean()
  })

  it('uses global ownership confirmation for an unmarked managed capture', async() => {
    const capture = await startCapture('maintenance-lease')
    const joined = new wire.JoinGroupMessage(
      'phone', captureOwner, 'automation', 'maintenance-lease')
    capture.reply(capture.channel, new wire.TransactionDoneMessage('phone', 0, true))
    capture.reply(capture.channel, joined)
    assert.equal(capture.responses.length, 0)

    capture.reply(wireutil.global, joined)
    assert.equal(capture.responses[0]?.status, 200)
    capture.assertClean()
  })

  it('cleans up a disconnected capture and ignores its late ownership acknowledgement', async() => {
    const clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    try {
      const capture = await startCapture('closed-lease', true)
      assert.equal(clock.countTimers(), 1)
      capture.close()
      capture.assertClean()
      assert.equal(clock.countTimers(), 0)

      const retry = await startCapture('new-lease', true)
      const late = new wire.JoinGroupMessage('phone', captureOwner, 'automation', 'closed-lease')
      capture.reply(wireutil.global, late)
      retry.reply(wireutil.global, late)
      assert.equal(capture.responses.length, 0)
      assert.equal(retry.responses.length, 0)

      retry.reply(wireutil.global,
        new wire.JoinGroupMessage('phone', captureOwner, 'automation', 'new-lease'))
      assert.equal(retry.responses[0]?.status, 200)
      retry.assertClean()
    }
    finally {
      clock.restore()
    }
  })

  it('releases the DB lock acquired after the capture disconnected', async() => {
    const lock = deferred()
    waitForLock = () => lock.promise
    const capture = beginCapture('closed-lease', true)
    const before = unlocks
    capture.close()
    assert.equal(unlocks, before)
    lock.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))

    capture.assertClean()
    assert.deepEqual(capture.responses, [])
    assert.deepEqual(capture.dispatched, [])
  })

  it('suppresses the failed DB lock response if the capture already disconnected', async() => {
    lockRefused = true
    const lock = deferred()
    waitForLock = () => lock.promise
    const before = unlocks
    const disconnected = beginCapture('closed-lease', true)
    disconnected.close()
    const connected = beginCapture('live-lease', true)
    lock.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))

    assert.equal(unlocks, before)
    assert.equal(disconnected.responses.length, 0)
    assert.equal(connected.responses[0]?.status, 503)
    assert.equal(disconnected.dispatched.length, 0)
    assert.equal(connected.dispatched.length, 0)
    disconnected.assertDetached()
    connected.assertDetached()
  })

  it('unlocks immediately on close while checking the automation release receipt', async() => {
    const checking = deferred()
    const lookup = deferred()
    lookupReceipt = async() => {
      checking.resolve()
      await lookup.promise
      return true
    }
    const capture = beginCapture('closed-lease', true)
    await checking.promise
    capture.close()
    capture.assertClean()
    lookup.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))

    capture.assertClean()
    assert.deepEqual(capture.responses, [])
    assert.deepEqual(capture.dispatched, [])
  })

  it('responds with description matching UserResponse schema (#302)', function() {
    const mockUser = {
      email: 'test@example.com'
    , name: 'Test User'
    , privilege: 'user'
    , groups: {
        subscribed: ['default']
      }
    }
    const req = {
      user: mockUser
    }
    let responseBody: UserResponseBody | undefined

    const res = {
      statusCode: 200
    , status(code: number) {
        this.statusCode = code
        return this
      }
    , json(body: unknown) {
        responseBody = body as UserResponseBody
        return this
      }
    }

    getUser(req as unknown as ApiRequest, res as unknown as Response)

    assert.ok(responseBody, 'Response json should be called')
    assert.equal(responseBody.success, true)
    assert.equal(responseBody.description, 'User Profile')
    assert.equal(responseBody.user, mockUser)

    const validator = ZSchema.create({safe: true, breakOnFirstError: false})
    const {valid, err} = validator.validate(responseBody, userResponseSchema)
    assert.equal(valid, true, `Schema mismatch: ${JSON.stringify(err?.details)}`)
  })

  it('fails swagger validation without description (regression guard for #302)', function() {
    const payloadWithoutDescription = {
      success: true
    , user: {email: 'test@example.com'}
    }
    const validator = ZSchema.create({safe: true, breakOnFirstError: false})
    const {valid, err} = validator.validate(payloadWithoutDescription, userResponseSchema)
    assert.equal(valid, false, 'Payload without description must fail validation')
    assert.ok(
      err?.details?.some(detail => detail.code === 'OBJECT_MISSING_REQUIRED_PROPERTY' &&
        detail.params.includes('description'))
    , 'Validation error should indicate missing description'
    )
  })
})
