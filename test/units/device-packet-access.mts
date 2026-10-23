import assert from 'node:assert/strict'
import sinon from 'sinon'
import {createDevicePacketGuard} from '../../lib/units/websocket/ios-access.js'
import {DevicePacketAccess, isDeviceCommand} from '../../lib/units/websocket/device-access.js'

describe('manual device packets during automation', function() {
  for (const platform of ['Android', 'iOS']) {
    it(`rejects ${platform} input during automation until release`, async function() {
      let device = {serial: 'PHONE', platform
      , channel: platform === 'iOS' ? 'ios:PHONE' : 'private-channel'
        , present: true, ready: true, group: {id: 'shared'}, owner: {email: 'runner@example.test'}
        , usage: 'automation' as string | null}
      const access = new DevicePacketAccess(async() => [device], async() => device)
      assert.equal(await access.allows(device.channel, ['shared']), false)
      device = {...device, usage: null}
      assert.equal(await access.allows(device.channel, ['shared']), true)
      assert.equal(await access.allows(device.channel, ['foreign']), false)
      device = {...device, channel: 'replacement-channel'}
      const previous = platform === 'iOS' ? 'ios:PHONE' : 'private-channel'
      assert.equal(await access.allows(previous, ['shared']), false)
    })
  }

  for (const platform of ['Android', 'iOS']) {
    it(`rejects ${platform} input when automation joins during its lookup`, async function() {
      const device = {serial: 'PHONE', platform
        , channel: platform === 'iOS' ? 'ios:PHONE' : 'private-channel'
        , present: true, ready: true, group: {id: 'shared'}, usage: null}
      let finish!: () => void, loading!: () => void
      const pending = new Promise<void>(resolve => {
        finish = resolve
      })
      const started = new Promise<void>(resolve => {
        loading = resolve
      })
      const access = new DevicePacketAccess(async() => [device], async() => {
        loading()
        await pending
        return device
      })
      const allowed = access.allows(device.channel, ['shared'])
      await started
      access.joined(device.serial, 'automation')
      finish()
      assert.equal(await allowed, false)
    })
  }

  it('blocks the join persistence gap and clears the released state', async function() {
    const device = {serial: 'PHONE', channel: 'private', present: true, ready: true
    , group: {id: 'shared'}}
    const access = new DevicePacketAccess(async() => [device], async() => device)
    access.joined('PHONE', 'automation')
    assert.equal(await access.allows('private', ['shared']), false)
    access.released('PHONE')
    assert.equal(await access.allows('private', ['shared']), true)
    assert.equal(await access.allows('unknown', ['shared']), false)
  })

  it('covers controls while allowing subscriptions and metadata', function() {
    for (const event of ['input.touchDown', 'input.keyPress', 'clipboard.paste', 'device.reboot'
      , 'device.unlock', 'device.install', 'device.iosPower', 'group.invite', 'group.kick'
      , 'shell.command', 'connect.start', 'browser.open', 'account.add', 'wifi.set'
      , 'display.rotate'
      , 'forward.create', 'screen.capture', 'fs.list', 'logcat.start']) {
      assert.equal(isDeviceCommand(event), true, event)
    }
    for (const event of [null, undefined, 42, {}, ['input.touchDown']
      , 'tx.cleanup', 'tx.punch', 'user.settings.update', 'device.note']) {
      assert.equal(isDeviceCommand(event), false, String(event))
    }
  })
})


describe('ordered device authorization', function() {
  function fixture(platform = 'iOS', privilege?: string) {
    let device = {serial: 'PHONE', platform
      , channel: platform === 'iOS' ? 'ios:PHONE' : 'private-channel'
      , present: true, ready: true, group: {id: 'shared'}, owner: {email: 'owner@example.test'}
      , usage: null as string | null}
    let lookups = 0
    let fail = false
    const cancelled: unknown[][] = []
    const load = async() => {
      lookups++
      if (fail) {
        throw new Error('database unavailable')
      }
      return device
    }
    const access = new DevicePacketAccess(async() => [device], load)
    const user = {email: 'viewer@example.test', ...(privilege ? {privilege} : {})
      , groups: {subscribed: ['shared']}}
    const guard = createDevicePacketGuard(user, load, (...args) => cancelled.push(args), {
      matches: isDeviceCommand
      , allows: (channel, groups, lookup) => access.allows(channel, groups, lookup)
      , source: channel => access.source(channel)
      , checkpoint: () => access.checkpoint()
      , current: (channel, checkpoint) => access.current(channel, checkpoint)
    })
    const dispatch = (event: string, response = 'tx.request') =>
      new Promise<Error | undefined>(resolve => guard([event, device.channel, response], resolve))
    return {dispatch, guard, cancelled, lookups: () => lookups, device: () => device
      , update: (change: Partial<typeof device>) => {
        device = {...device, ...change}
      }
      , fail: (value: boolean) => {
        fail = value
      }}
  }

  it('loads a fresh iOS snapshot after a completed batch and preserves ordinary admin access',
    async function() {
    const f = fixture('iOS', 'admin')
    assert.equal(await f.dispatch('device.lock'), undefined)
    assert.equal(f.lookups(), 1)
    f.update({group: {id: 'foreign'}})
    assert.equal((await f.dispatch('device.lock'))?.message, 'Device access denied')
    assert.equal(f.lookups(), 2)
  })

  for (const platform of ['Android', 'iOS']) {
    it(`cancels ${platform} automation commands including admin requests`, async function() {
      const f = fixture(platform, 'admin')
      f.update({usage: 'automation'})
      assert.equal((await f.dispatch('group.kick'))?.message, 'Device access denied')
      assert.deepEqual(f.cancelled, [['tx.request', {
        source: 'PHONE', seq: 0, success: false, data: 'Device access denied'
      }]])
      f.update({usage: null})
      assert.equal(await f.dispatch('device.lock'), undefined)
    })

    it(`cancels ${platform} failed lookups and accepts the next valid packet`, async function() {
      const f = fixture(platform, 'admin')
      f.fail(true)
      assert.equal((await f.dispatch('device.lock'))?.message, 'Device access unavailable')
      assert.deepEqual(f.cancelled, [['tx.request', {
        source: 'PHONE', seq: 0, success: false, data: 'Device access unavailable'
      }]])
      f.fail(false)
      assert.equal(await f.dispatch('device.lock'), undefined)
    })
  }

  it('does not emit cancellation to an unvalidated response channel', async function() {
    const f = fixture('iOS')
    assert.equal((await f.dispatch('device.lock', 'user.notifications'))?.message,
      'Device access denied')
    assert.deepEqual(f.cancelled, [])
    const malformed = await new Promise<Error | undefined>(resolve =>
      f.guard(['device.lock', null, 'tx.invalid'], resolve))
    assert.equal(malformed?.message, 'Device access denied')
    assert.equal(f.cancelled.length, 1)
  })

  it('preserves Android input order while the first lookup is pending', async function() {
    let release!: () => void
    const first = new Promise<void>(resolve => {
      release = resolve
    })
    const device = {serial: 'ANDROID', platform: 'Android', channel: 'private'
      , present: true, ready: true, group: {id: 'shared'}}
    let lookups = 0
    const load = async() => {
      if (++lookups === 1) {
        await first
      }
      return device
    }
    const access = new DevicePacketAccess(async() => [device], load)
    const user = {email: 'owner@example.test', groups: {subscribed: ['shared']}}
    const guard = createDevicePacketGuard(user
      , load, () => assert.fail('Owned input must not be rejected'), {
        matches: isDeviceCommand
        , allows: (channel, groups, lookup) => access.allows(channel, groups, lookup)
        , source: channel => access.source(channel)
        , checkpoint: () => access.checkpoint()
        , current: (channel, checkpoint) => access.current(channel, checkpoint)
      })
    const delivered: string[] = []
    const down = new Promise<void>(resolve => guard(['input.touchDown', device.channel], error => {
      assert.ifError(error)
      delivered.push('down')
      resolve()
    }))
    const up = new Promise<void>(resolve => guard(['input.touchUp', device.channel], error => {
      assert.ifError(error)
      delivered.push('up')
      resolve()
    }))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(lookups, 1)
    assert.deepEqual(delivered, [])
    release()
    await Promise.all([down, up])
    assert.deepEqual(delivered, ['down', 'up'])
  })
})

describe('bounded device authorization batches', function() {
  function fixture(platform: string, delay = 20, limits = {}) {
    let device = {serial: 'PHONE', platform
      , channel: platform === 'iOS' ? 'ios:PHONE' : 'private-channel'
      , present: true, ready: true, group: {id: 'shared'}, owner: {email: 'owner@example.test'}
      , usage: null as string | null}
    let lookups = 0
    let fail = false
    let disconnected = 0
    const cancelled: unknown[][] = []
    const load = async() => {
      lookups++
      const snapshot = device
      await new Promise(resolve => setTimeout(resolve, delay))
      if (fail) {
        throw new Error('database unavailable')
      }
      return snapshot
    }
    const access = new DevicePacketAccess(async() => [device], load)
    const guard = createDevicePacketGuard({email: 'owner@example.test'
      , groups: {subscribed: ['shared']}}, load, (...args) => cancelled.push(args), {
      matches: isDeviceCommand
      , allows: (channel, groups, lookup) => access.allows(channel, groups, lookup)
      , source: channel => access.source(channel)
      , checkpoint: () => access.checkpoint()
      , current: (channel, checkpoint) => access.current(channel, checkpoint)
    }, {...limits, disconnect: () => disconnected++})
    const dispatch = (event: string, response?: string) =>
      new Promise<Error | undefined>(resolve => guard([event, device.channel, response], resolve))
    return {guard, access, dispatch, cancelled, channel: device.channel
      , lookups: () => lookups, disconnected: () => disconnected
      , update: (change: Partial<typeof device>) => {
        device = {...device, ...change}
      }
      , fail: (value: boolean) => {
        fail = value
      }}
  }

  for (const platform of ['Android', 'iOS']) {
    for (const delay of [20, 100]) {
      it(`keeps a 60 Hz ${platform} gesture bounded with ${delay} ms lookups`, async function() {
        const clock = sinon.useFakeTimers()
        try {
          const f = fixture(platform, delay)
          const sent: string[] = []
          const delivered: string[] = []
          const deliveredAt: number[] = []
          const send = (event: string) => {
            const id = `${sent.length}:${event}`
            sent.push(id)
            f.guard([event, f.channel, {seq: sent.length}], error => {
              assert.ifError(error)
              delivered.push(id)
              deliveredAt.push(Date.now())
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
          assert.equal(sent.length, 126)
          assert.deepEqual(delivered, sent, 'No gesture packet may be lost or reordered')
          assert.ok(deliveredAt.at(-1)! <= 1000 + 2 * delay)
          assert.ok(f.lookups() < sent.length / 2, 'Pending packets share the in-flight snapshot')
          const before = f.lookups()
          const next = f.dispatch('input.keyPress')
          await clock.tickAsync(delay)
          assert.equal(await next, undefined)
          assert.equal(f.lookups(), before + 1,
            'The next batch must query again, without a TTL cache')
        }
        finally {
          clock.restore()
        }
      })
    }

    for (const transition of ['ownership', 'channel', 'group', 'absence'
      , 'readiness', 'subscriptions']) {
      it(`rejects stale ${platform} input after a ${transition} notification`, async function() {
        const clock = sinon.useFakeTimers()
        try {
          const f = fixture(platform)
          const first = f.dispatch('input.touchDown', 'tx.first')
          const tail = f.dispatch('input.touchUp', 'tx.tail')
          await clock.tickAsync(10)
          switch (transition) {
          case 'ownership': f.update({owner: {email: 'next@example.test'}}); break
          case 'channel': f.update({channel: 'replacement'}); break
          case 'group': f.update({group: {id: 'other'}}); break
          case 'absence': f.update({present: false}); break
          case 'readiness': f.update({ready: false}); break
          }
          f.access.invalidate(transition === 'subscriptions' ? undefined : 'PHONE')
          await clock.tickAsync(10)
          assert.equal((await first)?.message, 'Device access denied')
          assert.equal((await tail)?.message, 'Device access denied')
          assert.equal(f.cancelled.length, 2)
        }
        finally {
          clock.restore()
        }
      })
    }

    it(`rejects a ${platform} batch crossing a complete automation session`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform)
        const pending = f.dispatch('input.touchDown')
        await clock.tickAsync(10)
        f.access.joined('PHONE', 'automation')
        f.access.released('PHONE')
        await clock.tickAsync(10)
        assert.equal((await pending)?.message, 'Device access denied')
        const next = f.dispatch('input.touchDown')
        await clock.tickAsync(20)
        assert.equal(await next, undefined)
      }
      finally {
        clock.restore()
      }
    })

    it(`rechecks ${platform} automation notifications between deliveries`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform)
        let first: Error | undefined, tail: Error | undefined
        let completed = 0
        f.guard(['input.touchDown', f.channel], error => {
          first = error
          completed++
          f.access.joined('PHONE', 'automation')
          f.access.released('PHONE')
        })
        f.guard(['input.touchUp', f.channel], error => {
          tail = error
          completed++
        })
        await clock.tickAsync(20)
        assert.equal(completed, 2)
        assert.equal(first, undefined)
        assert.equal(tail?.message, 'Device access denied')
      }
      finally {
        clock.restore()
      }
    })

    it(`preserves a ${platform} batch when another device changes ownership`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture(platform)
        const pending = f.dispatch('input.touchDown')
        await clock.tickAsync(10)
        f.access.joined('OTHER', 'automation')
        await clock.tickAsync(10)
        assert.equal(await pending, undefined)
      }
      finally {
        clock.restore()
      }
    })
  }

  it('does not block another device behind a slow lookup', async function() {
    let release!: () => void
    const slow = new Promise<void>(resolve => {
      release = resolve
    })
    const devices = ['SLOW', 'FAST'].map(serial => ({serial, platform: 'Android', channel: serial
      , present: true, ready: true, group: {id: 'shared'}}))
    const load = async(serial: string) => {
      if (serial === 'SLOW') {
        await slow
      }
      return devices.find(device => device.serial === serial)
    }
    const access = new DevicePacketAccess(async() => devices, load)
    const guard = createDevicePacketGuard({email: 'owner@example.test'
      , groups: {subscribed: ['shared']}}
      , load, () => assert.fail('Access should be allowed'), {
        matches: isDeviceCommand
        , allows: (channel, groups, lookup) => access.allows(channel, groups, lookup)
        , source: channel => access.source(channel)
      })
    const delivered: string[] = []
    const pending = new Promise<void>(resolve => guard(['input.touchDown', 'SLOW'], error => {
      assert.ifError(error)
      delivered.push('SLOW')
      resolve()
    }))
    await new Promise<void>(resolve => guard(['input.touchDown', 'FAST'], error => {
      assert.ifError(error)
      delivered.push('FAST')
      resolve()
    }))
    assert.deepEqual(delivered, ['FAST'])
    release()
    await pending
    assert.deepEqual(delivered, ['FAST', 'SLOW'])
  })

  it('cancels every failed batch transaction and loads again on recovery', async function() {
    const clock = sinon.useFakeTimers()
    try {
      const f = fixture('iOS')
      f.fail(true)
      const first = f.dispatch('device.lock', 'tx.first')
      const second = f.dispatch('device.lock', 'tx.second')
      await clock.tickAsync(20)
      assert.equal((await first)?.message, 'Device access unavailable')
      assert.equal((await second)?.message, 'Device access unavailable')
      assert.equal(f.cancelled.length, 2)
      assert.equal(f.lookups(), 1)
      f.fail(false)
      const recovered = f.dispatch('device.lock')
      await clock.tickAsync(20)
      assert.equal(await recovered, undefined)
      assert.equal(f.lookups(), 2)
    }
    finally {
      clock.restore()
    }
  })

  for (const failure of ['timeout', 'overflow']) {
    it(`cancels the complete gesture and disconnects on ${failure}`, async function() {
      const clock = sinon.useFakeTimers()
      try {
        const f = fixture('Android', 100, {lookupTimeoutMs: 20
          , maxPendingPackets: failure === 'overflow' ? 2 : 256})
        const pending = ['input.touchDown', 'input.touchCommit', 'input.touchUp']
          .map((event, index) => f.dispatch(event, `tx.${index}`))
        await clock.tickAsync(20)
        const reason = failure === 'timeout' ? 'Device access lookup timed out' :
          'Device access queue limit exceeded'
        assert.deepEqual((await Promise.all(pending)).map(error => error?.message),
          [reason, reason, reason])
        assert.equal(f.cancelled.length, 3)
        assert.equal(f.disconnected(), 1)
        const lookups = f.lookups()
        assert.equal((await f.dispatch('input.touchUp'))?.message, 'Device access denied')
        await clock.tickAsync(100)
        assert.equal(f.lookups(), lookups)
      }
      finally {
        clock.restore()
      }
    })
  }

  it('bounds concurrent device queues and cancels all pending transactions', async function() {
    const clock = sinon.useFakeTimers()
    try {
      const f = fixture('Android', 100, {maxChannels: 2})
      const pending = [f.channel, 'unknown-one', 'unknown-two'].map((channel, index) =>
        new Promise<Error | undefined>(resolve =>
          f.guard(['device.lock', channel, `tx.${index}`], resolve)))
      const errors = await Promise.all(pending)
      assert.ok(errors.every(error => error?.message === 'Device access queue limit exceeded'))
      assert.equal(f.disconnected(), 1)
      assert.equal(f.cancelled.length, 3)
      await clock.tickAsync(100)
    }
    finally {
      clock.restore()
    }
  })

  it('applies the deadline to unresolved channel lookups throughout a batch', async function() {
    const clock = sinon.useFakeTimers()
    try {
      let visibleLookups = 0
      let disconnected = 0
      const load = async() => null
      const access = new DevicePacketAccess(async() => {
        if (++visibleLookups > 1) {
          await new Promise(() => {})
        }
        return []
      }, load)
      const guard = createDevicePacketGuard({email: 'owner@example.test'
        , groups: {subscribed: ['shared']}}, load, () => {}, {
        matches: isDeviceCommand
        , allows: (channel, groups, lookup) => access.allows(channel, groups, lookup)
        , source: channel => access.source(channel)
      }, {lookupTimeoutMs: 20, disconnect: () => disconnected++})
      const pending = ['tx.first', 'tx.second'].map(response =>
        new Promise<Error | undefined>(resolve =>
          guard(['device.lock', 'unknown', response], resolve)))
      await clock.tickAsync(20)
      assert.deepEqual((await Promise.all(pending)).map(error => error?.message),
        ['Device access denied', 'Device access lookup timed out'])
      assert.equal(disconnected, 1)
    }
    finally {
      clock.restore()
    }
  })
})
