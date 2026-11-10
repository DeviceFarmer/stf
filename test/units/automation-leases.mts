import assert from 'node:assert/strict'
import events from 'node:events'
import sinon from 'sinon'
import {AutomationLease} from '../../lib/util/automation-lease.js'
import group from '../../lib/units/device/plugins/group.js'
import lifecycle from '../../lib/util/lifecycle.js'
import {IosBridge} from '../../lib/units/ios-provider/bridge.js'
import type {PrototypeClient} from '../../lib/units/ios-provider/client.js'
import type {GroupPlugin} from '../../lib/types/device-plugins.js'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'

const serial = 'lease-test-device'
const owner = new wire.OwnerMessage('runner@example.test', 'Runner', 'runner-group')
const otherOwner = new wire.OwnerMessage('other@example.test', 'Other', 'other-group')
const requirements = [new wire.DeviceRequirement('serial', serial, wire.RequirementType.EXACT)]
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const ownerEmail = (bridge: IosBridge) => bridge.owner?.email
type Handler = (channel: string, message: unknown) => unknown

function decodeReply(packets: Buffer[][]) {
  const envelope = wire.Envelope.decode(packets.at(-1)![1]!)
  assert.equal(envelope.type, wire.TransactionDoneMessage.$code)
  return wire.TransactionDoneMessage.decode(envelope.message)
}

describe('Provider automation lease fence', function() {
  afterEach(() => sinon.restore())

  it('expires in milliseconds and rejects an expired lease before its timer runs', function() {
    const clock = sinon.useFakeTimers({now: 10000, toFake: ['Date', 'setTimeout', 'clearTimeout']})
    const expired = sinon.spy()
    const lease = new AutomationLease(expired)
    lease.start(owner.email, 'lease-a', 100)
    clock.tick(99)
    lease.assertCurrent(owner.email, 'lease-a')
    clock.tick(1)
    assert.equal(expired.callCount, 1)
    assert.throws(() => lease.assertCurrent(owner.email, 'lease-a'), /Stale/)
  })

  it('renew never captures a free device and rejects stale or foreign owner tokens', function() {
    const lease = new AutomationLease(() => {})
    assert.throws(() => lease.renew(owner.email, 'lease-a', 100), /Stale/)
    lease.start(owner.email, 'lease-b', 1000)
    assert.throws(() => lease.renew(owner.email, 'lease-a', 100), /Stale/)
    assert.throws(() => lease.renew(otherOwner.email, 'lease-b', 100), /Stale/)
    lease.clear()
  })

  it('replaces the expiration timer only after successful renewal', function() {
    const clock = sinon.useFakeTimers({now: 10000, toFake: ['Date', 'setTimeout', 'clearTimeout']})
    const expired = sinon.spy()
    const lease = new AutomationLease(expired)
    lease.start(owner.email, 'lease-a', 100)
    clock.tick(80)
    assert.equal(lease.renew(owner.email, 'lease-a', 100), 10180)
    clock.tick(99)
    assert.equal(expired.callCount, 0)
    clock.tick(1)
    assert.equal(expired.callCount, 1)
  })

  function android() {
    sinon.stub(lifecycle, 'observe')
    const handlers = new Map<number, Handler>()
    const router = {on(type: {$code: number}, handler: Handler) {
      handlers.set(type.$code, handler)
      return router
    }}
    const packets: Buffer[][] = []
    const channels = Object.assign(new events.EventEmitter(), {
      register: sinon.spy(), unregister: sinon.spy(), keepalive: sinon.spy()
    })
    const plugin = group.invoke({serial, groupTimeout: 1000}, {channel: 'solo'}, {serial}, {
      wake() {}, acquireWakeLock() {}, releaseWakeLock() {}
    }, router, {send(packet: Buffer[]) {
      packets.push(packet)
    }}, {
      subscribe() {}, unsubscribe() {}
    }, channels) as GroupPlugin
    return {plugin, packets, channels, async send(message: wireutil.Message) {
      handlers.get(message.$code)!('reply', message)
      await flush()
      await flush()
    }}
  }

  it('Android rejects stale release after the same runner reacquires the phone', async function() {
    const f = android()
    await f.send(new wire.GroupMessage(owner, 1000, requirements, 'automation', 'lease-a'))
    await f.send(new wire.AutomationLeaseMessage(serial, owner, 'lease-a', 'release'))
    assert.equal(decodeReply(f.packets).success, true)
    await f.send(new wire.GroupMessage(owner, 1000, requirements, 'automation', 'lease-b'))
    await f.send(new wire.AutomationLeaseMessage(serial, owner, 'lease-a', 'release'))
    assert.equal(decodeReply(f.packets).success, false)
    assert.equal((await f.plugin.get()).email, owner.email)
    await f.send(new wire.AutomationLeaseMessage(serial, otherOwner, 'lease-b', 'renew', 1000))
    assert.equal(decodeReply(f.packets).success, false)
    await f.send(new wire.AutomationLeaseMessage(serial, owner, 'lease-b', 'renew', 1000))
    assert.equal(decodeReply(f.packets).success, true)
    await f.plugin.leave('test_complete')
  })

  it('Android expires a fenced lease despite channel activity', async function() {
    const f = android()
    const clock = sinon.useFakeTimers({now: 10000, toFake: ['Date', 'setTimeout', 'clearTimeout']})
    await f.send(new wire.GroupMessage(owner, 100, requirements, 'automation', 'lease-a'))
    assert.equal(f.channels.register.firstCall.args[1].timeout, Infinity)
    clock.tick(80)
    f.plugin.keepalive()
    clock.tick(20)
    await flush()
    await assert.rejects(Promise.resolve(f.plugin.get()))
  })

  async function ios() {
    const packets: Buffer[][] = []
    const png = Buffer.alloc(24)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png)
    png.writeUInt32BE(100, 16)
    png.writeUInt32BE(200, 20)
    const client = {
      async device() {
        return {udid: serial, state: 'ready', generation: 1, instance: 'test'}
      }
    , async request() {
        return new Response(png)
      }
    } as unknown as PrototypeClient
    const bridge = new IosBridge({serial, name: 'test', marketName: 'test', screenUrl: 'ws://test'
      , storageUrl: 'http://test', groupTimeout: 900}, client,
    (channel, data) => packets.push([Buffer.from(channel), data]), () => {}, error => {
      throw error
    })
    await bridge.poll()
    bridge.handle(bridge.solo, wireutil.envelope(new wire.DeviceRegisteredMessage(serial)))
    return {bridge, packets, async send(message: wireutil.Message) {
      const replies = () => packets.filter(p =>
        wire.Envelope.decode(p[1]!).type === wire.TransactionDoneMessage.$code).length
      const before = replies()
      bridge.handle(bridge.channel, wireutil.transaction('reply', message))
      for (let attempt = 0; attempt < 50 && replies() === before; attempt++) {
        await flush()
      }
      assert.equal(replies(), before + 1)
    }}
  }

  it('iOS fences stale and foreign lease operations', async function() {
    const f = await ios()
    await f.send(new wire.AutomationLeaseMessage(serial, owner, 'lease-a', 'renew', 1000))
    assert.equal(decodeReply(f.packets).success, false)
    assert.equal(f.bridge.owner, null)
    await f.send(new wire.GroupMessage(owner, 1000, requirements, 'automation', 'lease-a'))
    const join = f.packets.map(p => wire.Envelope.decode(p[1]!))
      .find(p => p.type === wire.JoinGroupMessage.$code)!
    assert.equal(wire.JoinGroupMessage.decode(join.message).leaseId, 'lease-a')
    await f.send(new wire.AutomationLeaseMessage(serial, owner, 'lease-a', 'release'))
    assert.equal(decodeReply(f.packets).success, true)
    await f.send(new wire.GroupMessage(owner, 1000, requirements, 'automation', 'lease-b'))
    await f.send(new wire.AutomationLeaseMessage(serial, owner, 'lease-a', 'release'))
    assert.equal(decodeReply(f.packets).success, false)
    assert.equal(ownerEmail(f.bridge), owner.email)
    await f.send(new wire.AutomationLeaseMessage(serial, otherOwner, 'lease-b', 'renew', 1000))
    assert.equal(decodeReply(f.packets).success, false)
    await f.send(new wire.AutomationLeaseMessage(serial, owner, 'lease-b', 'renew', 1000))
    assert.equal(decodeReply(f.packets).success, true)
    f.bridge.leave('test_complete')
  })

  for (const [platform, setup] of [['Android', android], ['iOS', ios]] as const) {
    it(`${platform} permits acquisition after a rejected lease timeout`, async function() {
      const f = await setup()
      await f.send(new wire.GroupMessage(owner, 2147483648, requirements, 'automation', 'invalid'))
      assert.equal(decodeReply(f.packets).success, false)
      await f.send(new wire.GroupMessage(owner, 1000, requirements, 'automation', 'valid'))
      assert.equal(decodeReply(f.packets).success, true)
      await f.send(new wire.AutomationLeaseMessage(serial, owner, 'valid', 'release'))
      assert.equal(decodeReply(f.packets).success, true)
    })
  }

  it('iOS uses wire timeout milliseconds while its CLI default remains seconds', async function() {
    const f = await ios()
    const clock = sinon.useFakeTimers({now: 10000, toFake: ['Date', 'setTimeout', 'clearTimeout']})
    await f.send(new wire.GroupMessage(owner, 100, requirements, 'automation', 'lease-a'))
    clock.tick(99)
    f.bridge.keepalive()
    assert.equal(ownerEmail(f.bridge), owner.email)
    clock.tick(1)
    assert.equal(f.bridge.owner, null)
    await f.send(new wire.GroupMessage(owner, null, requirements))
    clock.tick(899999)
    await f.bridge.poll()
    assert.equal(ownerEmail(f.bridge), owner.email)
    clock.tick(2)
    await f.bridge.poll()
    assert.equal(f.bridge.owner, null)
  })
})
