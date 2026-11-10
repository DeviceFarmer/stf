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
const unsetDeviceOwner = sinon.stub()
const mocks = [
  mockModule(new URL('../../lib/db/index.js', import.meta.url), {default: {
    ensureConnectivity: (start: unknown) => start
  }})
, mockModule(new URL('../../lib/db/api.js', import.meta.url), {default: {
    setDeviceOwner, unsetDeviceOwner
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
const leave = wireutil.envelope(new wire.LeaveGroupMessage('phone', owner, 'automation_release'))
const reply = wireutil.reply('phone').okay()

describe('processor ownership', function() {
  beforeEach(function() {
    setDeviceOwner.reset()
    unsetDeviceOwner.reset()
  })

  it('publishes a capture with the owner, lease and usage persisted together', async function() {
    setDeviceOwner.resolves({errors: 0, replaced: 1})
    const processor = fixture()
    const join = wireutil.envelope(new wire.JoinGroupMessage('phone', owner, 'automation', 'lease'))
    const published = processor.app.whenSent(join)
    processor.device.emit('message', wireutil.global, join)
    assert.deepEqual(processor.app.packets, [])
    await published
    assert.equal(setDeviceOwner.callCount, 1)
    assert.deepEqual(setDeviceOwner.firstCall.args.slice(2), ['lease', 'automation'])
    assert.deepEqual(processor.app.packets, [[wireutil.global, join]])
  })

  it('keeps transaction replies independent of ownership writes on another processor', async() => {
    let persisted = () => {}
    unsetDeviceOwner.returns(new Promise(resolve => {
      persisted = () => resolve({errors: 0, replaced: 1})
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
    assert.equal(unsetDeviceOwner.firstCall.args[1].reservationId, 'reservation-a')
    assert.deepEqual(writer.app.packets, [[wireutil.global, leave]])
  })

  it('persists a leave after a preceding capture on the same processor', async() => {
    let captured = () => {}
    setDeviceOwner.returns(new Promise(resolve => {
      captured = () => resolve({errors: 0, replaced: 1})
    }))
    unsetDeviceOwner.resolves({errors: 0, replaced: 1})
    const processor = fixture()
    const join = wireutil.envelope(new wire.JoinGroupMessage('phone', owner, 'automation', 'lease'))
    const released = processor.app.whenSent(leave)
    processor.device.emit('message', wireutil.global, join)
    processor.device.emit('message', wireutil.global, leave)
    await nextTurn()
    assert.equal(unsetDeviceOwner.callCount, 0)
    captured()
    await released
    assert.deepEqual(processor.app.packets, [[wireutil.global, join], [wireutil.global, leave]])
  })

  it('does not publish a stale leave or replace later successful command replies', async() => {
    unsetDeviceOwner.onFirstCall().resolves({errors: 0, replaced: 0})
    unsetDeviceOwner.onSecondCall().rejects(new Error('temporary database failure'))
    const processor = fixture()
    processor.device.emit('message', wireutil.global, leave)
    await nextTurn()
    processor.device.emit('message', wireutil.global, leave)
    await nextTurn()
    processor.device.emit('message', 'command-reply', reply)
    assert.deepEqual(processor.app.packets, [['command-reply', reply]])
  })
})
