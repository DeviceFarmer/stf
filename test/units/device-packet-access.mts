import assert from 'node:assert/strict'
import sinon from 'sinon'
import {createDevicePacketGuard} from '../../lib/units/websocket/ios-access.js'
import {DevicePacketAccess, isDeviceCommand} from '../../lib/units/websocket/device-access.js'
import {isValidSerial} from '../../lib/units/websocket/access.js'
import type {DeviceAccess} from '../../lib/units/websocket/access.js'

function fixture(platform = 'Android', delay = 0, options = {}) {
  let device: DeviceAccess = {serial: 'PHONE', platform
    , channel: platform === 'iOS' ? 'ios:PHONE' : 'private-channel'
    , present: true, ready: true, group: {id: 'shared'}
    , owner: {email: 'owner@example.test', reservationId: 'first'}, usage: null}
  let lookups = 0; let channelLookups = 0; let resets = 0; let fail = false
  const cancelled: unknown[][] = []
  const load = async() => {
    lookups++
    const snapshot = structuredClone(device)
    if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    if (fail) {
      throw new Error('database unavailable')
    }
    return snapshot
  }
  const access = new DevicePacketAccess(async channel => {
    channelLookups++
    return device.channel === channel ? device : null
  }, load)
  const user = {email: 'owner@example.test', groups: {subscribed: ['shared']}}
  const guard = createDevicePacketGuard(user, load, (...args) => cancelled.push(args), {
    matches: isDeviceCommand
    , allows: (channel, groups, lookup) => access.allows(channel, groups, lookup)
    , source: channel => access.source(channel)
    , snapshot: row => access.snapshot(row)
    , session: channel => access.session(channel)
    , checkpoint: () => access.checkpoint()
    , current: (channel, checkpoint) => access.current(channel, checkpoint)
  }, {...options, resetGesture: () => resets++})
  const channel = device.channel!
  const dispatch = (event: string, response?: string) =>
    new Promise<Error | undefined>(resolve => guard([event, channel, response], resolve))
  return {guard, dispatch, access, user, cancelled, channel, load
    , lookups: () => lookups, channelLookups: () => channelLookups, resets: () => resets
    , device: () => device, update: (change: Partial<DeviceAccess>) => {
      device = {...device, ...change}
    }, fail: (value: boolean) => {
      fail = value
    }}
}

const tick = async(ms: number, operation: Promise<unknown>
  , clock: ReturnType<typeof sinon.useFakeTimers>) => {
  await clock.tickAsync(ms)
  return operation
}

describe('manual device packet authorization', function() {
  for (const platform of ['Android', 'iOS']) {
    it(`blocks ${platform} automation input including administrator requests`, async function() {
      const f = fixture(platform)
      Object.assign(f.user, {privilege: 'admin'})
      f.update({usage: 'automation'})
      for (const event of ['input.keyPress', 'device.lock', 'group.invite', 'group.kick']) {
        const error = await f.dispatch(event, 'tx.denied')
        assert.equal(error?.message, 'Device access denied')
      }
      assert.equal(f.cancelled.length, 4)
      assert.deepEqual(f.cancelled[0], ['tx.denied', {
        source: 'PHONE', seq: 0, success: false, data: 'Device access denied'
      }])
    })

    it(`bounds ${platform} input caching and reauthorizes other commands`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform)
        for (let index = 0; index < 60; index++) {
          assert.equal(await tick(0, f.dispatch('input.keyPress'), clock), undefined)
        }
        assert.equal(f.lookups(), 1)
        assert.equal(await tick(0, f.dispatch('device.lock'), clock), undefined)
        assert.equal(f.lookups(), 2, 'A cached input allow cannot authorize a command')
        await clock.tickAsync(101)
        f.update({group: {id: 'other'}})
        const denied = await tick(0, f.dispatch('input.keyPress'), clock) as Error
        assert.equal(denied.message, 'Device access denied')
        assert.equal(f.lookups(), 3)
      }
      finally {
        clock.restore()
      }
    })

    for (const delay of [0, 20, 100]) {
      it(`preserves a 60 Hz ${platform} gesture with ${delay} ms lookups`, async function() {
        const clock = sinon.useFakeTimers()
        try {
          const f = fixture(platform, delay)
          const sent: string[] = []; const delivered: string[] = []
          const send = (event: string) => {
            const id = `${sent.length}:${event}`
            sent.push(id)
            f.guard([event, f.channel], error => {
              assert.ifError(error)
              delivered.push(id)
            })
          }
          send('input.gestureStart')
          send('input.touchDown')
          send('input.touchCommit')
          for (let frame = 0; frame < 60; frame++) {
            setTimeout(() => {
              send('input.touchMove')
              send('input.touchCommit')
            }, frame * 1000 / 60)
          }
          setTimeout(() => {
            send('input.touchUp')
            send('input.touchCommit')
            send('input.gestureStop')
          }, 1000)
          await clock.tickAsync(1000 + 2 * delay)
          assert.deepEqual(delivered, sent)
          assert.equal(sent.length, 126)
          assert.ok(f.lookups() <= 11, `Observed ${f.lookups()} database reads`)
        }
        finally {
          clock.restore()
        }
      })
    }

    it(`reauthorizes the ${platform} tail after benign invalidation`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform, 20)
        const delivered: string[] = []
        const packets = ['input.gestureStart', 'input.touchDown', 'input.touchUp']
        for (const event of packets) {
          f.guard([event, f.channel], error => {
            assert.ifError(error)
            delivered.push(event)
            if (event === 'input.touchDown') {
              f.access.invalidate('PHONE')
            }
          })
        }
        await clock.tickAsync(40)
        assert.deepEqual(delivered, packets)
        assert.equal(f.lookups(), 2)
        assert.equal(f.resets(), 0)
      }
      finally {
        clock.restore()
      }
    })

    it(`fences old ${platform} tails from the same user in a new reservation`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform, 20)
        const results: Array<Error | undefined> = []
        for (const event of ['input.gestureStart', 'input.touchDown', 'input.touchUp']) {
          f.guard([event, f.channel], error => {
            results.push(error)
            if (event === 'input.touchDown') {
              f.update({owner: {email: 'owner@example.test', reservationId: 'second'}})
              f.access.released('PHONE')
              f.access.joined('PHONE', null, f.device().owner)
            }
          })
        }
        await clock.tickAsync(80)
        assert.equal(results.length, 3)
        assert.equal(results[0], undefined)
        assert.equal(results[1], undefined)
        assert.equal(results[2]?.message, 'Device access denied')
        assert.equal(f.resets(), 1)
        assert.equal(await tick(20, f.dispatch('input.gestureStart'), clock), undefined)
        assert.equal(await tick(0, f.dispatch('input.touchDown'), clock), undefined)
      }
      finally {
        clock.restore()
      }
    })

    it(`waits for ${platform} ownership persistence`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform, 20)
        const pending = f.dispatch('input.keyPress')
        await clock.tickAsync(10)
        f.access.joined('PHONE', 'automation', {email: 'runner@example.test'
          , reservationId: 'runner'})
        await clock.tickAsync(40)
        assert.equal((await pending)?.message, 'Device access denied')
        f.update({owner: {email: 'runner@example.test', reservationId: 'runner'}
          , usage: 'automation'})
        assert.equal((await tick(40, f.dispatch('input.keyPress'), clock) as Error).message,
          'Device access denied')
        f.access.released('PHONE')
        assert.equal((await tick(20, f.dispatch('input.keyPress'), clock) as Error).message,
          'Device access denied', 'A release notification cannot override a stale automated row')
        f.update({owner: null, usage: null})
        assert.equal(await tick(40, f.dispatch('group.invite'), clock), undefined)
      }
      finally {
        clock.restore()
      }
    })

    it(`rejects ${platform} revoked groups before persistence`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform)
        assert.equal(await tick(0, f.dispatch('input.keyPress'), clock), undefined)
        f.access.update('PHONE', {group: {id: 'foreign'}})
        assert.equal((await tick(0, f.dispatch('input.keyPress'), clock) as Error).message,
          'Device access denied')
        f.update({group: {id: 'foreign'}})
        f.user.groups.subscribed = ['foreign']
        f.access.invalidate()
        assert.equal(await tick(0, f.dispatch('input.keyPress'), clock), undefined)
        f.user.groups.subscribed = []
        f.access.invalidate()
        assert.equal((await tick(0, f.dispatch('input.keyPress'), clock) as Error).message,
          'Device access denied')
      }
      finally {
        clock.restore()
      }
    })
  }

  for (const platform of ['Android', 'iOS']) {
    for (const transition of ['channel', 'absence', 'readiness']) {
      it(`denies queued ${platform} input after ${transition} changes`, async function() {
        const clock = sinon.useFakeTimers()
        try {
          const f = fixture(platform, 20)
          const pending = f.dispatch('input.keyPress', 'tx.changed')
          await clock.tickAsync(10)
          const changes: Record<string, Partial<DeviceAccess>> = {
            channel: {channel: 'replacement'}, absence: {present: false}, readiness: {ready: false}
          }
          const change = changes[transition]!
          f.update(change)
          f.access.update('PHONE', change)
          await clock.tickAsync(50)
          assert.equal((await pending)?.message, 'Device access denied')
          assert.equal(f.cancelled.length, 1)
        }
        finally {
          clock.restore()
        }
      })
    }

    it(`preserves ${platform} input when another device changes owner`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform, 20)
        const pending = f.dispatch('input.keyPress')
        await clock.tickAsync(10)
        f.access.joined('OTHER', 'automation')
        await clock.tickAsync(10)
        assert.equal(await pending, undefined)
      }
      finally {
        clock.restore()
      }
    })

    it(`cancels all ${platform} transactions in an unavailable batch`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform, 20)
        f.fail(true)
        const pending = ['tx.first', 'tx.second'].map(response =>
          f.dispatch('device.lock', response))
        await clock.tickAsync(20)
        assert.ok((await Promise.all(pending)).every(error =>
          error?.message === 'Device access unavailable'))
        assert.equal(f.cancelled.length, 2)
        assert.equal(f.lookups(), 1)
        f.fail(false)
        assert.equal(await tick(20, f.dispatch('device.lock'), clock), undefined)
      }
      finally {
        clock.restore()
      }
    })
  }

  it('bounds unresolved channel lookups and rejects malformed targets', async function() {
    const clock = sinon.useFakeTimers()
    try {
      const access = new DevicePacketAccess(async() => new Promise(() => {}), async() => null)
      const cancelled: unknown[][] = []
      const guard = createDevicePacketGuard({email: 'owner@example.test'
        , groups: {subscribed: ['shared']}}, async() => null
        , (...args) => cancelled.push(args), {matches: isDeviceCommand
          , allows: (channel, groups, load) => access.allows(channel, groups, load)
          , source: channel => access.source(channel)}, {lookupTimeoutMs: 20})
      const pending = new Promise<Error | undefined>(resolve =>
        guard(['device.lock', 'unknown', 'tx.unresolved'], resolve))
      await clock.tickAsync(20)
      assert.equal((await pending)?.message, 'Device access lookup timed out')
      const malformed = await new Promise<Error | undefined>(resolve =>
        guard(['device.lock', null, 'tx.invalid'], resolve))
      assert.equal(malformed?.message, 'Device access denied')
      assert.equal(cancelled.length, 2)
    }
    finally {
      clock.restore()
    }
  })

  it('rejects old gesture tails after many other channel failures', async function() {
    const f = fixture('iOS')
    assert.equal(await f.dispatch('input.gestureStart'), undefined)
    f.update({owner: {email: 'owner@example.test', reservationId: 'second'}})
    f.access.joined('PHONE', null, f.device().owner)
    assert.equal((await f.dispatch('input.touchDown'))?.message, 'Device access denied')
    for (let index = 0; index < 130; index++) {
      const denied = await new Promise<Error | undefined>(resolve =>
        f.guard(['input.touchUp', `ios:OTHER-${index}`], resolve))
      assert.equal(denied?.message, 'Device access denied')
    }
    assert.equal((await f.dispatch('input.touchDown'))?.message, 'Device access denied')
    assert.equal(await f.dispatch('input.gestureStart'), undefined)
    assert.equal(await f.dispatch('input.touchDown'), undefined)
  })

  it('does not emit cancellations to unvalidated response channels', async function() {
    const f = fixture('iOS')
    f.update({owner: null})
    assert.equal((await f.dispatch('device.lock', 'user.notifications'))?.message
      , 'Device access denied')
    assert.deepEqual(f.cancelled, [])
  })

  it('renews expired snapshots while an existing queue still has pending input', async function() {
    const clock = sinon.useFakeTimers()
    try {
      const f = fixture('Android', 20)
      let delivered = 0
      const pending = Array.from({length: 20}, () => new Promise<void>(resolve => {
        f.guard(['input.keyPress', f.channel], error => {
          assert.ifError(error)
          delivered++
          if (delivered === 1) {
            clock.setSystemTime(Date.now() + 101)
          }
          resolve()
        })
      }))
      await clock.tickAsync(200)
      await Promise.all(pending)
      assert.equal(delivered, 20)
      assert.equal(f.lookups(), 2, 'The queue must not retain its first snapshot past the TTL')
    }
    finally {
      clock.restore()
    }
  })

  for (const failure of ['timeout', 'overflow']) {
    it(`isolates a channel ${failure} and safely resets its incomplete gesture`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture('Android', 100, {lookupTimeoutMs: 20
          , maxPendingPackets: failure === 'overflow' ? 2 : 256})
        const pending = ['input.gestureStart', 'input.touchDown', 'input.touchUp']
          .map((event, index) => f.dispatch(event, `tx.${index}`))
        await clock.tickAsync(20)
        const reason = failure === 'timeout' ? 'Device access lookup timed out' :
          'Device access queue limit exceeded'
        assert.deepEqual((await Promise.all(pending)).map(error => error?.message),
          [reason, reason, reason])
        assert.equal(f.resets(), 1)
        assert.equal(f.cancelled.length, 3)
        assert.equal((await f.dispatch('input.touchUp'))?.message, 'Device access denied')
        await clock.tickAsync(100)
      }
      finally {
        clock.restore()
      }
    })
  }

  it('isolates an overflow from other device queues', async function() {
    const clock = sinon.useFakeTimers()
    try {
      let resets = 0
      const devices: DeviceAccess[] = ['SLOW', 'FAST'].map(serial => ({serial, channel: serial
        , platform: 'Android', present: true, ready: true, group: {id: 'shared'}
        , owner: {email: 'owner@example.test', reservationId: serial}}))
      const load = async(serial: string) => {
        if (serial === 'SLOW') {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        return devices.find(device => device.serial === serial)
      }
      const access = new DevicePacketAccess(
        async channel => devices.find(row => row.channel === channel), load)
      const guard = createDevicePacketGuard({email: 'owner@example.test'
        , groups: {subscribed: ['shared']}}
        , load, () => {}, {matches: isDeviceCommand
          , allows: (channel, groups, lookup) => access.allows(channel, groups, lookup)
          , source: channel => access.source(channel)}
        , {maxPendingPackets: 2, maxChannels: 2, resetGesture: () => resets++})
      const slow = [0, 1, 2].map(index => new Promise<Error | undefined>(resolve =>
        guard(['input.keyPress', 'SLOW', `tx.${index}`], resolve)))
      const fast = new Promise<Error | undefined>(resolve =>
        guard(['input.keyPress', 'FAST'], resolve))
      await clock.tickAsync(0)
      assert.equal(await fast, undefined)
      assert.ok((await Promise.all(slow)).every(error =>
        error?.message === 'Device access queue limit exceeded'))
      assert.equal(resets, 1)
      await clock.tickAsync(100)
    }
    finally {
      clock.restore()
    }
  })

  it('bounds channel queues without cancelling already queued devices', async function() {
    const clock = sinon.useFakeTimers()
    try {
      const f = fixture('Android', 100, {maxChannels: 1})
      const allowed = f.dispatch('input.keyPress')
      const denied = new Promise<Error | undefined>(resolve =>
        f.guard(['input.keyPress', 'unknown'], resolve))
      assert.equal((await denied)?.message, 'Device access queue limit exceeded')
      await clock.tickAsync(100)
      assert.equal(await allowed, undefined)
      assert.equal(f.resets(), 0)
    }
    finally {
      clock.restore()
    }
  })

  it('recovers command authorization after a failed lookup', async function() {
    const f = fixture()
    f.fail(true)
    assert.equal((await f.dispatch('device.lock'))?.message, 'Device access unavailable')
    f.fail(false)
    assert.equal(await f.dispatch('device.lock'), undefined)
  })

  for (const serial of ['host.docker.internal:15555', '192.168.1.12:5555', '[::1]:5555'
    , 'adb-PHONE-key._adb-tls-connect._tcp']) {
    it(`authorizes Android TCP serial ${serial} without bypassing access checks`, async function() {
      const f = fixture()
      f.update({serial, owner: null})
      assert.ifError(await f.dispatch('group.invite', 'tx.acquire'))
      f.update({owner: {email: f.user.email, reservationId: 'tcp-session'}})
      f.access.joined(serial, null, f.device().owner)
      assert.ifError(await f.dispatch('input.keyPress'))
      assert.ifError(await f.dispatch('shell.command', 'tx.shell'))
      assert.deepEqual(f.cancelled, [])

      f.update({usage: 'automation'})
      f.access.joined(serial, 'automation', f.device().owner)
      for (const event of ['group.invite', 'input.keyPress', 'shell.command']) {
        assert.equal((await f.dispatch(event, 'tx.automation'))?.message, 'Device access denied')
      }

      f.update({usage: null, group: {id: 'private'}})
      f.access.update(serial, {usage: null, group: {id: 'private'}})
      for (const event of ['group.invite', 'input.keyPress', 'shell.command']) {
        assert.equal((await f.dispatch(event, 'tx.private'))?.message, 'Device access denied')
      }
    })
  }

  it('denies input to foreign or unowned Android devices', async function() {
    const authorized: unknown[] = []
    const f = fixture('Android', 0, {onAuthorizedInput: (...args: unknown[]) => {
      authorized.push(args)
    }})
    f.update({owner: {email: 'someone@example.test', reservationId: 'victim'}})
    for (const event of ['input.gestureStart', 'input.keyPress', 'input.type']) {
      assert.equal((await f.dispatch(event))?.message, 'Device access denied')
    }
    f.update({owner: null})
    f.access.released('PHONE')
    assert.equal((await f.dispatch('input.gestureStart'))?.message, 'Device access denied')
    assert.deepEqual(authorized, [])
    assert.equal(await f.dispatch('group.invite', 'tx.free'), undefined)
  })

  it('retains visibility and automation checks for stamped admin input', async function() {
    const authorized: {gestureId: string, reservationId: string}[] = []
    const f = fixture('Android', 0, {onAuthorizedInput: (_packet: unknown, metadata: any) => {
      authorized.push(metadata)
    }})
    Object.assign(f.user, {privilege: 'admin'})
    f.update({owner: {email: 'someone@example.test', reservationId: 'manual-reservation'}})
    assert.equal(await f.dispatch('input.gestureStart'), undefined)
    assert.match(authorized[0]!.gestureId, /^[a-f0-9-]{36}:1$/)
    assert.equal(authorized[0]!.reservationId, 'manual-reservation')
    assert.equal(f.lookups(), 1, 'Stamping reuses the authorization snapshot')
    f.update({usage: 'automation'})
    f.access.joined('PHONE', 'automation', f.device().owner)
    assert.equal((await f.dispatch('input.gestureStart'))?.message, 'Device access denied')
    f.update({usage: null, group: {id: 'hidden'}})
    f.access.update('PHONE', {usage: null, group: {id: 'hidden'}})
    assert.equal((await f.dispatch('input.keyPress'))?.message, 'Device access denied')
    assert.equal(authorized.length, 1)
  })

  it('validates serials and distinguishes controls from metadata', function() {
    for (const value of ['A', 'a'.repeat(128), '00008110-000625A02146201E', 'usb_serial.1'
      , 'host.docker.internal:15555', '[2001:db8::1]:5555']) {
      assert.equal(isValidSerial(value), true)
    }
    for (const value of ['', 'a'.repeat(129), 'a/b', 'a\\b', 'a b', 'a\n', 'a\0b'
      , 'a?b', 'a#b', null, 123]) {
      assert.equal(isValidSerial(value), false)
    }
    for (const event of ['input.touchDown', 'clipboard.paste', 'device.reboot', 'group.invite'
      , 'group.kick', 'shell.command', 'forward.create', 'screen.capture', 'fs.list'
      , 'display.rotate', 'account.add', 'sd.status', 'ringer.set', 'wifi.set', 'bluetooth.set'
      , 'logcat.start', 'connect.start', 'browser.open', 'store.open']) {
      assert.equal(isDeviceCommand(event), true)
    }
    for (const event of [null, 42, 'tx.cleanup', 'device.note', 'user.settings.update']) {
      assert.equal(isDeviceCommand(event), false)
    }
  })
})

describe('bounded indexed channel resolution', function() {
  it('deduplicates misses and invalidates them on targeted notifications', async function() {
    const clock = sinon.useFakeTimers()
    try {
      let calls = 0
      let row: DeviceAccess | null = null
      const access = new DevicePacketAccess(async() => {
        calls++
        await new Promise(resolve => setTimeout(resolve, 10))
        return row
      }, async() => row)
      const first = access.allows('private', ['shared'])
      const second = access.allows('private', ['shared'])
      await clock.tickAsync(10)
      assert.deepEqual(await Promise.all([first, second]), [false, false])
      for (let i = 0; i < 8; i++) {
        assert.equal(await access.allows('private', ['shared']), false)
      }
      assert.equal(calls, 1)
      row = {serial: 'PHONE', channel: 'private', group: {id: 'shared'}, present: true, ready: true}
      access.invalidate('PHONE')
      assert.equal(await tick(10, access.allows('private', ['shared']), clock), true)
      assert.equal(calls, 2)
      row = {...row, channel: 'replacement'}
      assert.equal(await access.allows('private', ['shared']), false)
    }
    finally {
      clock.restore()
    }
  })

  it('invalidates in-flight misses and expires negative results', async function() {
    const clock = sinon.useFakeTimers()
    try {
      let calls = 0; let release!: () => void
      const waiting = new Promise<void>(resolve => {
        release = resolve
      })
      const row = {serial: 'PHONE', channel: 'new', group: {id: 'shared'}
        , present: true, ready: true}
      const access = new DevicePacketAccess(async() => {
        if (++calls === 1) {
          await waiting
          return null
        }
        return row
      }, async() => row)
      const pending = access.allows('new', ['shared'])
      await clock.tickAsync(0)
      access.invalidate('PHONE')
      release()
      assert.equal(await pending, false)
      assert.equal(await access.allows('new', ['shared']), true)
      assert.equal(calls, 2)
      assert.equal(await access.allows('missing', []), false)
      await clock.tickAsync(251)
      assert.equal(await access.allows('missing', []), false)
      assert.equal(calls, 4)
    }
    finally {
      clock.restore()
    }
  })
})


describe('authorization cache eviction boundaries', function() {
  it('fails closed instead of forgetting an unpersisted wire observation', async function() {
    const row = {serial: 'PHONE', channel: 'private', present: true, ready: true
      , group: {id: 'shared'}, owner: {email: 'owner@example.test'}, usage: null}
    const access = new DevicePacketAccess(async() => row, async() => row, 2)
    access.joined('PHONE', 'automation')
    assert.equal(await access.allows('private', ['shared']), false)
    access.update('OTHER-1', {present: true})
    access.update('OTHER-2', {present: true})
    assert.equal(await access.allows('private', ['shared']), false)
    assert.equal(await access.allows('ios:PHONE', ['shared']), false)
  })

  it('invalidates allows when channel resolution evicts a mapping', async function() {
    const rows = Array.from({length: 130}, (_, index) => ({serial: `PHONE-${index}`
      , channel: `private-${index}`, present: true, ready: true, group: {id: 'shared'}}))
    const access = new DevicePacketAccess(async channel => rows.find(row => row.channel === channel)
      , async serial => rows.find(row => row.serial === serial))
    assert.equal(await access.allows('private-0', ['shared']), true)
    const checkpoint = access.checkpoint()
    for (const row of rows.slice(1)) {
      assert.equal(await access.allows(row.channel, ['shared']), true)
    }
    access.joined('PHONE-0', 'automation')
    assert.equal(access.current('private-0', checkpoint), false)
    assert.equal(await access.allows('private-0', ['shared']), false)
  })

  it('bounds negative channel entries even for distinct invented channels', async function() {
    let lookups = 0
    const access = new DevicePacketAccess(async() => {
      lookups++
      return null
    }, async() => null)
    for (let index = 0; index < 130; index++) {
      assert.equal(await access.allows(`invented-${index}`, ['shared']), false)
    }
    assert.equal(await access.allows('invented-129', ['shared']), false)
    assert.equal(lookups, 130)
    assert.equal(await access.allows('invented-0', ['shared']), false)
    assert.equal(lookups, 131)
  })
})
