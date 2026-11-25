import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {setImmediate as nextTurn} from 'node:timers/promises'
import sinon from 'sinon'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

type Packet = [string | Buffer, Buffer]
class Dealer extends EventEmitter {
  readonly packets: Packet[] = []

  send(packet: Packet) {
    this.packets.push(packet)
    this.emit('packet', packet)
  }

  whenSent(data: Buffer) {
    return new Promise<void>(resolve => {
      const match = (packet: Packet) => {
        if (packet[1].equals(data)) {
          this.off('packet', match)
          resolve()
        }
      }
      this.on('packet', match)
    })
  }
}

const dealers: Dealer[] = []
const setDeviceOwner = sinon.stub()
const releaseDeviceOwner = sinon.stub()
const setDeviceReady = sinon.stub()
const loadUser = sinon.stub()
const clearDeviceRestoreOwner = sinon.stub()
const loadDeviceBySerial = sinon.stub()
const lookupUserByAdbFingerprint = sinon.stub()
const lookupUserByVncAuthResponse = sinon.stub()
const mocks = [
  mockModule(new URL('../../lib/db/index.js', import.meta.url), {default: {
    ensureConnectivity: (start: unknown) => start
  }})
, mockModule(new URL('../../lib/db/api.js', import.meta.url), {default: {
    setDeviceOwner, releaseDeviceOwner, setDeviceReady, loadUser, clearDeviceRestoreOwner
  , loadDeviceBySerial, lookupUserByAdbFingerprint, lookupUserByVncAuthResponse
  }})
, mockModule(new URL('../../lib/util/adbutil.js', import.meta.url), {default: () => ({})})
, mockModule(new URL('../../lib/util/lifecycle.js', import.meta.url), {default: {observe() {}}})
, mockModule(new URL('../../lib/util/zmqutil.js', import.meta.url), {default: {socket() {
    const dealer = new Dealer()
    dealers.push(dealer)
    return dealer
  }}})
]
let startProcessor: typeof import('../../lib/units/processor/index.js').default
try {
  startProcessor = (await importFresh(new URL('../../lib/units/processor/index.js',
    import.meta.url))).default
}
finally {
  mocks.forEach(restore => restore())
}

function fixture() {
  const offset = dealers.length
  startProcessor({autoRestoreOwner: false, endpoints: {appDealer: [], devDealer: []}})
  return {app: dealers[offset]!, device: dealers[offset + 1]!}
}

const owner = new wire.OwnerMessage(
  'runner@example.test', 'Runner', 'runner-group', 'reservation-a'
)
const leave = wireutil.envelope(new wire.LeaveGroupMessage(
  'phone', owner, 'automation_release', 'lease'
))
const reply = wireutil.reply('phone').okay()

describe('processor ownership', function() {
  beforeEach(function() {
    setDeviceOwner.reset()
    releaseDeviceOwner.reset()
    setDeviceReady.reset()
    loadUser.reset()
    clearDeviceRestoreOwner.reset()
    loadDeviceBySerial.reset()
    lookupUserByAdbFingerprint.reset()
    lookupUserByVncAuthResponse.reset()
  })

  it('publishes a capture with the owner, lease and usage persisted together', async function() {
    setDeviceOwner.resolves({errors: 0, replaced: 1, applied: true})
    const processor = fixture()
    const join = wireutil.envelope(new wire.JoinGroupMessage('phone', owner, 'automation', 'lease'))
    const published = processor.app.whenSent(join)
    processor.device.emit('message', wireutil.global, join)
    assert.deepEqual(processor.app.packets, [])
    await published
    assert.equal(setDeviceOwner.callCount, 1)
    assert.deepEqual(setDeviceOwner.firstCall.args.slice(2), ['automation', 'lease', null])
    assert.deepEqual(processor.app.packets, [[wireutil.global, join]])
  })

  it('forwards a transaction reply after the durable join on the same processor', async() => {
    let persist = () => {}
    setDeviceOwner.returns(new Promise(resolve => {
      persist = () => resolve({errors: 0, replaced: 1, applied: true})
    }))
    const processor = fixture()
    const join = wireutil.envelope(new wire.JoinGroupMessage('phone', owner, 'automation', 'lease'))
    const responded = processor.app.whenSent(reply)
    processor.device.emit('message', wireutil.global, join)
    processor.device.emit('message', 'join-reply', reply)
    await nextTurn()
    assert.deepEqual(processor.app.packets, [])
    persist()
    await responded
    assert.deepEqual(processor.app.packets, [[wireutil.global, join], ['join-reply', reply]])
  })

  it('keeps transaction replies independent of ownership writes on another processor', async() => {
    let persisted = () => {}
    releaseDeviceOwner.returns(new Promise(resolve => {
      persisted = () => resolve({errors: 0, replaced: 1, applied: true})
    }))
    const writer = fixture()
    const responder = fixture()
    const published = writer.app.whenSent(leave)
    writer.device.emit('message', wireutil.global, leave)
    responder.device.emit('message', 'release-reply', reply)
    assert.deepEqual(writer.app.packets, [])
    assert.deepEqual(responder.app.packets, [['release-reply', reply]])
    persisted()
    await published
    assert.equal(releaseDeviceOwner.firstCall.args[1].reservationId, 'reservation-a')
    assert.deepEqual(writer.app.packets, [[wireutil.global, leave]])
  })

  it('persists a leave after a preceding capture on the same processor', async() => {
    let captured = () => {}
    setDeviceOwner.returns(new Promise(resolve => {
      captured = () => resolve({errors: 0, replaced: 1, applied: true})
    }))
    releaseDeviceOwner.resolves({errors: 0, replaced: 1, applied: true})
    const processor = fixture()
    const join = wireutil.envelope(new wire.JoinGroupMessage('phone', owner, 'automation', 'lease'))
    const released = processor.app.whenSent(leave)
    processor.device.emit('message', wireutil.global, join)
    processor.device.emit('message', wireutil.global, leave)
    await nextTurn()
    assert.equal(releaseDeviceOwner.callCount, 0)
    captured()
    await released
    assert.deepEqual(processor.app.packets, [[wireutil.global, join], [wireutil.global, leave]])
  })

  it('does not publish pending-leave or cancelled-join metadata across processors', async() => {
    let finishJoin = () => {}
    setDeviceOwner.returns(new Promise(resolve => {
      finishJoin = () => resolve({errors: 0, replaced: 1, applied: false})
    }))
    releaseDeviceOwner.resolves({errors: 0, replaced: 1, applied: false})
    const joining = fixture()
    const leaving = fixture()
    const join = wireutil.envelope(new wire.JoinGroupMessage('phone', owner, 'automation', 'lease'))
    joining.device.emit('message', wireutil.global, join)
    await nextTurn()
    leaving.device.emit('message', wireutil.global, leave)
    await nextTurn()
    assert.deepEqual(releaseDeviceOwner.firstCall.args.slice(1)
      , [owner, 'lease', 'automation_release'])
    finishJoin()
    await nextTurn()
    assert.deepEqual(joining.app.packets, [])
    assert.deepEqual(leaving.app.packets, [])
  })

  it('keeps a group.kick reply behind its committed owner release', async() => {
    let finishRelease = () => {}
    releaseDeviceOwner.returns(new Promise(resolve => {
      finishRelease = () => resolve({errors: 0, replaced: 1, applied: true})
    }))
    const processor = fixture()
    const replied = processor.app.whenSent(reply)
    processor.device.emit('message', wireutil.global, leave)
    processor.device.emit('message', 'release-reply', reply)
    await nextTurn()
    assert.deepEqual(processor.app.packets, [])
    finishRelease()
    await replied
    assert.deepEqual(processor.app.packets, [[wireutil.global, leave], ['release-reply', reply]])
  })

  it('does not publish a stale leave or replace later successful command replies', async() => {
    releaseDeviceOwner.onFirstCall().resolves({errors: 0, replaced: 0, applied: false})
    releaseDeviceOwner.onSecondCall().rejects(new Error('temporary database failure'))
    const processor = fixture()
    processor.device.emit('message', wireutil.global, leave)
    await nextTurn()
    processor.device.emit('message', wireutil.global, leave)
    await nextTurn()
    const responded = processor.app.whenSent(reply)
    processor.device.emit('message', 'command-reply', reply)
    await responded
    assert.deepEqual(processor.app.packets, [['command-reply', reply]])
  })

  it('persists the timeout a join reports so a reboot claim can carry it', async function() {
    setDeviceOwner.resolves({errors: 0, replaced: 1, applied: true})
    const processor = fixture()
    const join = wireutil.envelope(new wire.JoinGroupMessage('phone', owner, 'automation', null
      , 180000))
    const published = processor.app.whenSent(join)
    processor.device.emit('message', wireutil.global, join)
    await published
    assert.deepEqual(setDeviceOwner.firstCall.args.slice(2), ['automation', null, 180000])
  })

  describe('restoring an owner after a reboot', function() {
    const user = {
      email: 'runner@example.test', name: 'Runner', group: 'runner-group'
    , groups: {subscribed: ['origin-group']}
    }

    function readyWithClaim(claim: Record<string, unknown>) {
      setDeviceReady.resolves({changes: [{new_val: {
        serial: 'phone', owner: null, group: {id: 'origin-group'}
      , restoreOwner: {email: user.email, expiresAt: Date.now() + 60000, ...claim}
      }}]})
      loadUser.resolves(user)
    }

    async function restore() {
      const processor = fixture()
      const ready = wireutil.envelope(new wire.DeviceReadyMessage('phone', 'worker-channel'))
      const announced = processor.app.whenSent(ready)
      processor.device.emit('message', wireutil.global, ready)
      await announced
      return processor.device.packets
        .filter(([channel]) => channel === 'worker-channel')
        .map(([, data]) => wire.Envelope.decode(data))
        .filter(envelope => envelope.type === wire.AutoGroupMessage.$code)
        .map(envelope => wire.AutoGroupMessage.decode(envelope.message))
    }

    it('hands the device back with the usage and timeout of the reservation', async function() {
      readyWithClaim({usage: 'automation', timeout: 180000})
      const [autoGroup, ...rest] = await restore()
      assert.deepEqual(rest, [])
      assert.equal(autoGroup!.owner.email, user.email)
      assert.equal(autoGroup!.owner.group, user.group)
      assert.equal(autoGroup!.usage, 'automation')
      assert.equal(autoGroup!.timeout, 180000)
      // No ADB or VNC authorization waits on a restore, so it must not look like one
      assert.equal(autoGroup!.identifier, '')
      assert.equal(clearDeviceRestoreOwner.callCount, 0)
    })

    it('leaves usage and timeout unset for a plain reservation or an older claim', async() => {
      readyWithClaim({usage: null})
      const [autoGroup] = await restore()
      assert.equal(autoGroup!.usage, null)
      assert.equal(autoGroup!.timeout, null)
      assert.equal(autoGroup!.identifier, '')
    })

    it('drops an expired claim without handing the device back', async function() {
      readyWithClaim({usage: 'automation', timeout: 180000, expiresAt: Date.now() - 1})
      clearDeviceRestoreOwner.resolves({})
      assert.deepEqual(await restore(), [])
      assert.equal(clearDeviceRestoreOwner.callCount, 1)
      assert.equal(loadUser.callCount, 0)
    })
  })
  // An ADB key or VNC password names a user, but a device kept for someone else after a reboot
  // must not be handed to them on the strength of it
  describe('joining by credential while a device is kept for someone', function() {
    const keyOwner = {email: 'key@example.test', name: 'Key', group: 'key-group'}

    function claimFor(email: string) {
      loadDeviceBySerial.resolves({serial: 'phone', owner: null, group: {id: 'origin-group'}
        , restoreOwner: {email, expiresAt: Date.now() + 60000}})
    }

    async function joinBy(message: Parameters<typeof wireutil.envelope>[0]) {
      const processor = fixture()
      processor.device.emit('message', 'worker-channel', wireutil.envelope(message))
      await new Promise(resolve => setTimeout(resolve, 10))
      return processor.device.packets
        .map(([, data]) => wire.Envelope.decode(data))
        .filter(envelope => envelope.type === wire.AutoGroupMessage.$code)
        .map(envelope => wire.AutoGroupMessage.decode(envelope.message))
    }

    const byKey = () => new wire.JoinGroupByAdbFingerprintMessage('phone', 'fp', 'comment')
    const byVnc = () => new wire.JoinGroupByVncAuthResponseMessage('phone', 'response')

    it('does not offer a refused key to the current group as an unknown one', async function() {
      lookupUserByAdbFingerprint.resolves(keyOwner)
      claimFor('previous@example.test')
      const processor = fixture()
      processor.device.emit('message', 'worker-channel', wireutil.envelope(
        new wire.JoinGroupByAdbFingerprintMessage('phone', 'fp', 'comment', 'current-group')))
      await new Promise(resolve => setTimeout(resolve, 10))
      assert.deepEqual(processor.app.packets.filter(([channel]) =>
        channel.toString() === 'current-group'), [])
    })

    it('refuses a credential join by anyone but the claimant', async function() {
      lookupUserByAdbFingerprint.resolves(keyOwner)
      lookupUserByVncAuthResponse.resolves(keyOwner)
      claimFor('previous@example.test')
      assert.deepEqual(await joinBy(byKey()), [])
      assert.deepEqual(await joinBy(byVnc()), [])
    })

    it('lets the claimant, or anyone once the claim is gone, join by credential', async() => {
      lookupUserByAdbFingerprint.resolves(keyOwner)
      claimFor(keyOwner.email)
      assert.equal((await joinBy(byKey()))[0]!.owner.email, keyOwner.email)
      loadDeviceBySerial.resolves({serial: 'phone', owner: null, restoreOwner: null})
      assert.equal((await joinBy(byKey()))[0]!.owner.email, keyOwner.email)
    })
  })
})
