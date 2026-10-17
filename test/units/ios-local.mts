import assert from 'node:assert/strict'
import {parseIosConfig, iosDeviceId} from '../../lib/util/ios-config.ts'
import {nativeIosCommands, reserveIosPorts} from '../../lib/units/ios-provider/local.ts'
import net from 'node:net'

const input = {
  publicOrigin: 'http://localhost:7100', wdaBundleId: 'test.wda.xctrunner'
  , devices: [{udid: 'phone-00000001'}, {udid: 'phone-00000002'}]
}

describe('local iOS configuration', () => {
  it('supports common signing and a per-device override without requiring ports', () => {
    const config = parseIosConfig({...input, devices: [input.devices[0]
      , {udid: 'phone-00000002', wdaBundleId: 'other.wda.xctrunner', name: 'Second iPhone'}]})
    assert.equal(config.android, false)
    assert.equal(config.devices[0]!.wdaBundleId, 'test.wda.xctrunner')
    assert.equal(config.devices[1]!.wdaBundleId, 'other.wda.xctrunner')
    assert.equal(config.devices[1]!.name, 'Second iPhone')
    assert.notEqual(iosDeviceId(config.devices[0]!.udid), iosDeviceId(config.devices[1]!.udid))
    assert.equal(iosDeviceId('PHONE-00000001'), iosDeviceId('phone-00000001'))
  })

  it('rejects duplicate phones, unknown options and invalid origins before launch', () => {
    for (const bad of [null, {...input, port: 1234}, {...input, devices: []}
      , {...input, devices: [input.devices[0], input.devices[0]]}
      , {...input, devices: [input.devices[0], {udid: 'PHONE-00000001'}]}
      , {...input, publicOrigin: 'http://user:password@localhost:7100'}
      , {...input, publicOrigin: 'http://localhost:7100/path'}
      , {...input, publicOrigin: 'file:///tmp/stf'}
      , {...input, devices: [{udid: 'phone; touch /tmp/test'}]}
      , {...input, devices: [{udid: 'phone-00000001', port: 7400}]}
      , {...input, wdaBundleId: 'bad bundle'}]) {
      assert.throws(() => parseIosConfig(bad))
    }
  })

  it('reserves distinct native ports until the children can be started', async() => {
    const reserved = await reserveIosPorts(10)
    try {
      assert.equal(new Set(reserved.ports).size, 10)
      const contender = net.createServer()
      const error = await new Promise<NodeJS.ErrnoException>(resolve => {
        contender.once('error', resolve)
        contender.listen(reserved.ports[0], '0.0.0.0')
      })
      assert.equal(error.code, 'EADDRINUSE')
    }
    finally {
      await reserved.release()
    }
    await reserved.release()
  })

  it('keeps native commands, screens and persistent directories on the selected UDID', () => {
    const config = parseIosConfig(input)
    const targets = new Set<string>()
    for (const [index, device] of config.devices.entries()) {
      const selected = nativeIosCommands(device, {
        ports: Array.from({length: 5}, (_, i) => 30000 + index * 5 + i)
      , directory: '/private/' + iosDeviceId(device.udid), tokenFile: '/private/token-' + index
      , publicOrigin: config.publicOrigin, apiPort: 7106, storagePort: 7102
      , push: 'tcp://127.0.0.1:7116', sub: 'tcp://127.0.0.1:7114'
      , node: '/usr/bin/node', ios: '/usr/local/bin/ios', root: '/repo'
      })
      for (const command of [selected.tunnel, selected.runtime]) {
        assert.ok(command.includes('--udid=' + device.udid))
      }
      assert.ok(selected.provider.includes('--serial=' + device.udid))
      assert.ok(selected.provider.includes('--connect-sub=tcp://127.0.0.1:7114'))
      assert.ok(selected.provider.includes('--screen-url=ws://localhost:7100/ios/' +
        iosDeviceId(device.udid) + '/screen'))
      targets.add(selected.screenTarget)
    }
    assert.equal(targets.size, 2)
  })
})
