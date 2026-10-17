import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {AssistiveTouch} from '../assistive-touch.mts'
import type {WdaClient} from '../wda.mts'

function fixture(enabled = false, unsupported = false, ios26 = false, lock = false) {
  const commands: string[][] = []
  const taps: unknown[] = []
  const original = {defaultActiveApplication: 'auto', activeAppDetectionPoint: '80,80'}
  let settings = {...original}
  let stage = 0
  const rect = {x: 100, y: 300, width: 70, height: 70}
  const button = (name: string, children: unknown[] = [], frame = rect) =>
    ({type: ios26 ? 'Other' : 'Button'
      , name: ios26 && name === 'AssistiveTouch' ? 'AssistiveTouchNubbit' : name
      , isAccessible: '1', isVisible: '1', isEnabled: '1', rect: frame, children})
  const wda = {
    async call(_method: string, route: string, body: any) {
      if (route === '/appium/settings') {
        if (body) {
          settings = {...settings, ...body.settings}
        }
        return {value: {...settings}}
      }
      if (route === '/window/size') {
        return {value: {width: 430, height: 932}}
      }
      if (route === '/wda/activeAppInfo') {
        const [x, y] = settings.activeAppDetectionPoint.split(',').map(Number)
        return {value: {bundleId: stage || (x! < 65 && y! >= 300 && y! <= 360) ?
          'com.apple.assistivetouchd' : 'test.app'}}
      }
      if (route.startsWith('/source')) {
        const children = [button('AssistiveTouch', [], {x: 0, y: 300, width: 60, height: 60})]
        if (stage === 1) {
          children[0] = button(unsupported ? 'SOS' : 'Устройство')
        }
        if (stage === 2) {
          children[0] = button(lock ? 'Блокировка экрана' : 'Еще')
        }
        if (stage === 3) {
          children[0] = ios26 ? button('Встряхнуть') :
            button('Встряхивание', [{type: 'Image', name: 'axaction.device.shake_DI'}])
        }
        return {value: {type: 'Application', name: 'AssistiveTouch'
          , children: stage ? [button('AssistiveTouch', children,
            {x: 67, y: 200, width: 296, height: 296})] : children}}
      }
      throw new Error('Unexpected route ' + route)
    }
    , async gesture(point: unknown) {
      taps.push(point)
      stage++
    }
  } as unknown as WdaClient
  const shake = new AssistiveTouch('ios', 'selected-iphone', async(_binary, args) => {
    commands.push(args)
    return {AssistiveTouchEnabled: enabled}
  }, async(_binary, args) => {
    commands.push(args)
    return ''
  })
  return {shake, wda, commands, taps, settings: () => settings, original}
}

describe('physical iPhone Shake', () => {
  it('supports iOS 26 accessible Other controls and the Russian Shake label', async() => {
    const f = fixture(false, false, true)
    await f.shake.perform(f.wda, new AbortController().signal)
    assert.equal(f.taps.length, 4)
    assert.deepEqual(f.settings(), f.original)
    assert.ok(f.commands.every(args => args.includes('--udid=selected-iphone')))
    assert.equal(f.commands.at(-1)?.at(-1), 'disable')
  })

  it('locks via the known iOS 26 system action and restores AssistiveTouch', async() => {
    const f = fixture(false, false, true, true)
    await f.shake.perform(f.wda, new AbortController().signal, 'lock')
    assert.equal(f.taps.length, 3)
    assert.deepEqual(f.settings(), f.original)
    assert.equal(f.commands.at(-1)?.at(-1), 'disable')
  })

  it('finds a moved control without tapping other apps and restores original settings', async() => {
    const f = fixture()
    await f.shake.perform(f.wda, new AbortController().signal)
    assert.equal(f.taps.length, 4)
    assert.deepEqual(f.settings(), f.original)
    assert.ok(f.commands.every(args => args.includes('--udid=selected-iphone')))
    assert.equal(f.commands.at(-1)?.at(-1), 'disable')
  })

  it('rejects unknown menus without other actions and restores enabled state', async() => {
    const f = fixture(true, true)
    await assert.rejects(f.shake.perform(f.wda, new AbortController().signal),
      /IOS_SHAKE_MENU_UNSUPPORTED/)
    assert.equal(f.taps.length, 1)
    assert.deepEqual(f.settings(), f.original)
    assert.deepEqual(f.commands.slice(-2).map(args => args.at(-1)), ['disable', 'enable'])
  })

  it('cleans up when the owner cancels and issues no further gestures', async() => {
    const f = fixture()
    const abort = new AbortController()
    f.wda.gesture = async() => {
      f.taps.push('first tap')
      abort.abort()
    }
    await assert.rejects(f.shake.perform(f.wda, abort.signal), {name: 'AbortError'})
    assert.equal(f.taps.length, 1)
    assert.deepEqual(f.settings(), f.original)
    assert.equal(f.commands.at(-1)?.at(-1), 'disable')
  })
})
