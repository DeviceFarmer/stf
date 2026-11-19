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
const mocks = [
  mockModule(new URL('../../lib/db/index.js', import.meta.url), {default: {
    ensureConnectivity: (start: unknown) => start
  }})
, mockModule(new URL('../../lib/db/api.js', import.meta.url), {default: {
    setDeviceOwner, releaseDeviceOwner
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
    assert.deepEqual(setDeviceOwner.firstCall.args.slice(2), ['automation', 'lease'])
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
    assert.deepEqual(releaseDeviceOwner.firstCall.args.slice(1), [owner, 'lease'])
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
})
