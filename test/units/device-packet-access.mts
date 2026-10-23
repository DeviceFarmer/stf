import assert from 'node:assert/strict'
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

  it('loads one fresh iOS snapshot per packet and preserves ordinary admin access',
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
