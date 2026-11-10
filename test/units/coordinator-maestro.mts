import assert from 'node:assert/strict'
import {inspectMaestroDevice, prepareMaestroDevice, cleanupMaestroDevice}
  from '../../lib/util/maestro-device.js'

function phone() {
  const packages = new Set<string>(['example.business.app'])
  const settings = new Map([
    ['system/accelerometer_rotation', '0'], ['system/user_rotation', '0']
  , ['global/window_animation_scale', '1.0'], ['global/transition_animation_scale', '1.0']
  , ['global/animator_duration_scale', '1.0']
  , ['secure/default_input_method', 'example.ime/.Service']
  ])
  const events: string[] = []
  let processes = ''
  let instrumentation = ''
  const execute = async(command: string) => {
    events.push(command)
    if (command === 'pm list packages') {
 return [...packages].map(name => 'package:' + name).join('\n')
}
    if (command === 'ps -A') {
 return processes
}
    if (command === 'dumpsys activity instrumentation') {
 return instrumentation
}
    if (command.startsWith('settings get ')) {
      const [, , scope, name] = command.split(' ')
      return settings.get(scope + '/' + name) || 'null'
    }
    if (command.startsWith('settings put ')) {
      const [, , scope, name, ...value] = command.split(' ')
      settings.set(scope + '/' + name, value.join(' ').slice(1, -1))
      return ''
    }
    if (command.startsWith('pm uninstall ')) {
      packages.delete(command.slice('pm uninstall '.length))
      return 'Success'
    }
    return ''
  }
  return {packages, settings, events, execute
  , retainProcess: () => {
 processes = 'u0_a123 123 1 0 S dev.mobile.maestro'
}
  , retainInstrumentation: () => {
 instrumentation = 'ActiveInstrumentation dev.mobile.maestro.test'
}}
}

describe('server-owned Maestro device lifecycle', () => {
  it('restores rotation/animations/IME and removes only the drivers introduced by its lease',
    async() => {
    const p = phone()
    p.packages.add('dev.mobile.maestro')
    const baseline = await inspectMaestroDevice(p.execute)
    await prepareMaestroDevice(p.execute)
    p.packages.add('dev.mobile.maestro.test')
    p.settings.set('system/accelerometer_rotation', '1')
    p.settings.set('global/animator_duration_scale', '0')
    p.settings.set('secure/default_input_method', 'dev.mobile.maestro/.Ime')
    await cleanupMaestroDevice(p.execute, baseline)
    assert.deepEqual([...p.packages], ['example.business.app', 'dev.mobile.maestro'])
    assert.equal(p.settings.get('system/accelerometer_rotation'), '0')
    assert.equal(p.settings.get('global/animator_duration_scale'), '1.0')
    assert.equal(p.settings.get('secure/default_input_method'), 'example.ime/.Service')
    assert.ok(p.events.indexOf('wm dismiss-keyguard') >
      p.events.indexOf('input keyevent KEYCODE_WAKEUP'))
    assert.ok(!p.events.some(command => command.includes('uninstall example.business.app')))
  })

  it('refuses successful cleanup while a driver process or instrumentation remains', async() => {
    for (const kind of ['process', 'instrumentation']) {
      const p = phone()
      const baseline = await inspectMaestroDevice(p.execute)
      kind === 'process' ? p.retainProcess() : p.retainInstrumentation()
      await assert.rejects(cleanupMaestroDevice(p.execute, baseline), /still (running|registered)/)
      assert.ok(!p.events.some(command => command.startsWith('pm uninstall ')))
    }
  })

  it('does not mask a failed native command as confirmed cleanup', async() => {
    const p = phone()
    const baseline = await inspectMaestroDevice(p.execute)
    await assert.rejects(cleanupMaestroDevice(async command => {
      if (command.startsWith('am force-stop')) {
 throw new Error('ADB timeout')
}
      return p.execute(command)
    }, baseline), /ADB timeout/)
  })
})
