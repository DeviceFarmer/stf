import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {parseIosConfig, iosDeviceId} from '../../../lib/util/ios-config.ts'
import {renderIosCompose, renderIosNginx} from '../compose-config.mts'
import type {ComposeDocument} from '../compose-config.mts'

const base: ComposeDocument = {
  name: 'other-project'
  , services: Object.fromEntries(['migrate', 'api', 'app', 'auth', 'proxy', 'provider', 'adb']
    .map(name => [name, {image: name === 'proxy' ? 'nginx:alpine' : 'test-stf:local'}]))
  , volumes: {'rethinkdb-data': {name: 'other-project_rethinkdb-data'}}
  , networks: {default: {name: 'other-project_default'}}
}
const config = parseIosConfig({publicOrigin: 'http://192.168.0.50:7100'
  , wdaBundleId: 'test.wda.xctrunner'
  , devices: [1, 2, 3].map(i => ({udid: 'phone-0000000' + i}))})
const options = {repository: '/repo', directory: '/private/stf-ios'
  , stfImage: 'test-stf:local', iosImage: 'test-ios:local', socketPath: '/run/usbmuxd'}

describe('local Compose iPhone fleet', () => {
  it('isolates three phones with no published device ports or obligatory Android services', () => {
    const {document, screenRoutes} = renderIosCompose(base, config, options)
    assert.ok(base.services.adb, 'Rendering must not mutate the input')
    assert.equal(document.services.adb, undefined)
    assert.equal(document.services.provider, undefined)
    assert.deepEqual(document.volumes!['rethinkdb-data'], {})
    assert.equal(document.networks.default.name, undefined)
    assert.equal(screenRoutes.length, 3)
    const tokens = new Set<string>()
    const states = new Set<string>()
    for (const [index, device] of config.devices.entries()) {
      const id = iosDeviceId(device.udid)
      const anchor = document.services[id + '-network']!
      assert.deepEqual(anchor.command.slice(-1), ['namespace'])
      assert.equal(anchor.privileged, undefined)
      for (const role of ['tunnel', 'runtime', '']) {
        const service = document.services[id + (role ? '-' + role : '')]!
        assert.equal(service.network_mode, 'service:' + id + '-network')
        assert.equal(service.ports, undefined)
        assert.ok(service.command.includes('--' + (role === '' ? 'serial' : 'udid') + '=' +
          device.udid))
        if (role !== 'tunnel') {
          assert.equal(service.privileged, undefined)
          assert.equal(service.user, '1000:1000')
          assert.deepEqual(service.cap_drop, ['ALL'])
          const token = service.volumes.find((v: any) => v.target === '/token/token')
          tokens.add(token.source)
          assert.equal(token.read_only, true)
        }
      }
      const tunnel = document.services[id + '-tunnel']!
      assert.equal(tunnel.privileged, true)
      states.add(tunnel.volumes[1])
      assert.ok(tunnel.command.includes('supervise'))
      assert.equal(tunnel.volumes[0].source, '/run/usbmuxd')
      assert.equal(tunnel.volumes[0].bind.create_host_path, false)
      assert.equal(screenRoutes[index]!.target, id + '-network:17440')
      assert.equal(document.services[id]!.depends_on[id + '-runtime'].condition, 'service_healthy')
    }
    assert.equal(tokens.size, 3)
    assert.equal(states.size, 3)
    assert.deepEqual(document.services.proxy!.ports, [
      {target: 7100, published: '7100', protocol: 'tcp'}])
  })

  it('retains Android when explicitly enabled and preserves the configured public origin', () => {
    const {document} = renderIosCompose(base, {...config, android: true}
      , {...options, androidScreenGrabber: 'minicap-apk'})
    assert.ok(document.services.adb)
    assert.ok(document.services.provider)
    assert.equal(document.services.provider!.environment.SCREEN_GRABBER, 'minicap-apk')
    assert.ok(document.services.app!.command.includes(config.publicOrigin + '/'))
    assert.ok(document.services.auth!.command.includes(config.publicOrigin + '/'))
  })

  it('accepts every Android screen grabber and rejects unknown ones', () => {
    for (const grabber of ['auto', 'minicap-bin', 'minicap-apk']) {
      const {document} = renderIosCompose(base, {...config, android: true}
        , {...options, androidScreenGrabber: grabber})
      assert.equal(document.services.provider!.environment.SCREEN_GRABBER, grabber)
    }
    assert.throws(() => renderIosCompose(base, {...config, android: true}
      , {...options, androidScreenGrabber: 'minicap'}), /SCREEN_GRABBER/)
  })

  it('routes only the selected screen and passes authentication to the provider', () => {
    const {screenRoutes} = renderIosCompose(base, config, options)
    const nginx = renderIosNginx('server {\n    location / {\n    }\n}', screenRoutes)
    for (const route of screenRoutes) {
      assert.ok(nginx.includes('location = ' + route.path))
      assert.ok(nginx.includes('set $ios_backend ' + route.target))
    }
    assert.ok(nginx.includes('proxy_pass http://$ios_backend/;'))
    for (const header of ['Origin $http_origin', 'Cookie $http_cookie'
      , 'Authorization $http_authorization', 'Upgrade $http_upgrade']) {
      assert.ok(nginx.includes('proxy_set_header ' + header + ';'))
    }
    assert.throws(() => renderIosNginx('missing location', screenRoutes))
  })
})
