import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import plugin, {FoldablePosture} from '../../lib/units/device/plugins/foldable-posture.js'
import type {FoldablePostureMode} from '../../lib/types/android-display.js'

const manualOwner = 'operator@example.test'
const reservation = 'current-reservation'
const names = ['CLOSED', 'TENT', 'HALF_OPENED', 'OPENED', 'CONCURRENT_INNER', 'CONCURRENT_OUTER']

function fakeDevice() {
  const commands: string[][] = []
  const hardware = {
    marker: null as string | null
    , rotationMarker: null as string | null
    , override: null as number | null
    , base: 3
    , committed: 3
    , refuseReset: false
    , rotationMode: 'free'
    , fixedRotation: 'default'
    , confirmOverride: true
    , stateNames: names
    , resources: {folded: '', unfolded: ''}
    , beforeOverride: () => Promise.resolve()
    , beforeDump: (_signal?: AbortSignal): void | Promise<void> => {}
    , beforeRotationWrite: (_args: string[]): void | Promise<void> => {}
  }
  const record = (id: number) =>
    `DeviceState{identifier=${id}, name='${names[id]}', app_accessible=true}`
  const shell = async(args: string[], signal?: AbortSignal) => {
    signal?.throwIfAborted()
    commands.push(args)
    if (args[0] === 'wm') {
      assert.ok(args[1] === 'user-rotation' || args[1] === 'fixed-to-user-rotation')
      const setting = args[1] === 'user-rotation' ? 'rotationMode' : 'fixedRotation'
      if (args.length === 2) {
        return `${hardware[setting]}\n`
      }
      await hardware.beforeRotationWrite(args)
      hardware[setting] = args.slice(2).join(' ')
      return ''
    }
    if (args[0] === 'sh') {
      const marker = args[4]?.includes('foldable-rotation') ? 'rotationMarker' : 'marker'
      if (args.length === 6) {
        hardware[marker] = args[5]!
        return ''
      }
      return hardware[marker] ?? 'absent\n'
    }
    if (args[0] === 'rm') {
      const marker = args[2]?.includes('foldable-rotation') ? 'rotationMarker' : 'marker'
      hardware[marker] = null
      return ''
    }
    if (args[0] === 'dumpsys') {
      await hardware.beforeDump(signal)
      const base = `mBaseState=Optional[${record(hardware.base)}]`
      const override = hardware.override === null ? 'Optional.empty' :
        `Optional[${record(hardware.override)}]`
      return `  ${base}\n  mOverrideState=${override}\n`
    }
    if (args[0] === 'cmd' && args[1] === 'overlay') {
      assert.deepEqual(args.slice(0, 4), ['cmd', 'overlay', 'lookup', 'android'])
      return args[4] === 'android:array/config_foldedDeviceStates' ?
        hardware.resources.folded : hardware.resources.unfolded
    }
    assert.deepEqual(args.slice(0, 2), ['cmd', 'device_state'])
    switch (args[2]) {
    case 'print-states':
      return hardware.stateNames
        .map((name, id) => `DeviceState{identifier=${id}, name='${name}', ...},`)
        .join('\n')
    case 'print-state':
      return `${hardware.committed}\n`
    case 'state':
      if (args[3] === 'reset') {
        if (!hardware.refuseReset) {
          hardware.override = null
          hardware.committed = hardware.base
        }
      }
      else {
        assert.notEqual(hardware.marker, null, 'mark ownership before mutating Android')
        await hardware.beforeOverride()
        hardware.override = Number(args[3])
        if (hardware.confirmOverride) {
          hardware.committed = hardware.override
        }
      }
      return ''
    default:
      throw new Error('Unexpected test ADB command')
    }
  }

  let leaving = false
  const releaseOwner = () => {
    leaving = true
  }
  const errors: unknown[] = []
  const changes: Array<FoldablePostureMode | null> = []
  const posture = new FoldablePosture(shell, (email, id) =>
    email === manualOwner && id === reservation && !leaving, error => errors.push(error))
  posture.on('change', mode => changes.push(mode))
  const set = (mode: FoldablePostureMode) => posture.set(mode, manualOwner, reservation)
  const overrideCommands = () => commands.filter(args => args[2] === 'state').map(args => args[3])
  return {commands, hardware, changes, errors, posture, set, releaseOwner, overrideCommands, shell}
}

describe('Android foldable provider posture', function() {
  it('uses the tested commands and verifies sensor control on leave', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    assert.deepEqual(await f.set('folded'), {previous: 3, committed: 0})
    assert.equal(f.hardware.marker, '0')
    assert.deepEqual(await f.set('unfolded'), {previous: 0, committed: 3})
    assert.equal(f.hardware.marker, '3')
    f.releaseOwner()
    await f.posture.release()
    assert.deepEqual(f.overrideCommands(), ['0', '3', 'reset'])
    assert.deepEqual(f.changes, ['sensor', 'folded', 'unfolded', 'sensor'])
    assert.equal(f.hardware.override, null)
    assert.equal(f.hardware.marker, null)
  })

  it('reports the committed state, including intermediate hinge positions', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    await f.set('folded')
    assert.deepEqual(await f.set('sensor'), {previous: 0, committed: 3})
    f.hardware.base = f.hardware.committed = 2
    assert.deepEqual(await f.set('sensor'), {previous: 2, committed: 2})
  })

  it('holds a manual angle and restores the previous lock on release', async function() {
    const f = fakeDevice()
    f.hardware.rotationMode = 'lock 3'
    await f.posture.initialize()
    await f.posture.rotate(0, manualOwner, reservation)
    assert.equal(f.hardware.rotationMode, 'lock 0')
    await f.posture.rotate(90, manualOwner, reservation)
    assert.equal(f.hardware.rotationMode, 'lock 1')
    assert.equal(f.hardware.fixedRotation, 'enabled')
    f.releaseOwner()
    await f.posture.release()
    assert.equal(f.hardware.rotationMode, 'lock 3')
    assert.equal(f.hardware.fixedRotation, 'default')
  })

  it('preserves a rotation preference changed outside STF during the session', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    await f.posture.rotate(90, manualOwner, reservation)
    assert.equal(f.hardware.rotationMode, 'lock 1')
    f.hardware.rotationMode = 'lock 2'
    f.hardware.fixedRotation = 'disabled'
    f.releaseOwner()
    await f.posture.release()
    assert.equal(f.hardware.rotationMode, 'lock 2')
    assert.equal(f.hardware.fixedRotation, 'disabled')
    assert.equal(f.hardware.rotationMarker, null)
    await assert.rejects(f.posture.rotate(0, manualOwner, reservation), /manual reservation/)
  })

  it('restores the original rotation after a failed second command', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    await f.posture.rotate(90, manualOwner, reservation)
    f.hardware.beforeRotationWrite = args => {
      if (args.join(' ') === 'wm user-rotation lock 2') {
        throw new Error('ADB transport closed')
      }
    }
    await assert.rejects(f.posture.rotate(180, manualOwner, reservation), /ADB transport closed/)
    assert.equal(f.hardware.rotationMode, 'lock 1')
    await f.posture.release()
    assert.equal(f.hardware.rotationMode, 'free')
    assert.equal(f.hardware.fixedRotation, 'default')
    assert.equal(f.hardware.rotationMarker, null)
  })

  it('recovers an STF rotation after restarting the worker', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    await f.posture.rotate(90, manualOwner, reservation)
    assert.notEqual(f.hardware.rotationMarker, null)

    const restarted = new FoldablePosture(f.shell, () => true, error => f.errors.push(error))
    await restarted.initialize()
    assert.equal(restarted.mode, 'sensor')
    assert.equal(f.hardware.rotationMode, 'free')
    assert.equal(f.hardware.fixedRotation, 'default')
    assert.equal(f.hardware.rotationMarker, null)
  })

  it('preserves an external angle after a confirmed STF change', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    await f.posture.rotate(90, manualOwner, reservation)
    await f.posture.rotate(180, manualOwner, reservation)
    f.hardware.rotationMode = 'lock 1'
    await f.posture.release()
    assert.equal(f.hardware.rotationMode, 'lock 1', 'the earlier STF lock was superseded')
    assert.equal(f.hardware.fixedRotation, 'default')
    assert.equal(f.hardware.rotationMarker, null)
  })

  it('cleans up an override Android accepted but never committed', async function() {
    const f = fakeDevice()
    f.hardware.confirmOverride = false
    await f.posture.initialize()
    await assert.rejects(f.set('folded'), /did not confirm/)
    assert.equal(f.posture.mode, 'sensor')
    assert.equal(f.hardware.marker, null)
    assert.deepEqual(f.overrideCommands(), ['0', 'reset'])
  })

  it('retains the marker on failed restoration and permits a retry', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    await f.set('folded')
    f.hardware.refuseReset = true
    f.releaseOwner()
    await assert.rejects(f.posture.release(), /sensor restoration could not be verified/)
    assert.equal(f.hardware.override, 0)
    assert.equal(f.hardware.marker, '0')
    assert.equal(f.posture.mode, null)
    assert.deepEqual(f.overrideCommands(), ['0', 'reset', 'reset'])

    f.hardware.refuseReset = false
    await f.posture.release()
    assert.equal(f.hardware.marker, null)
    assert.equal(f.posture.mode, 'sensor')
  })

  it('waits for an in-flight override before restoring sensor control', async function() {
    let finishOverride!: () => void
      , entered!: () => void
    const ready = new Promise<void>(resolve => {
      finishOverride = resolve
    })
    const begun = new Promise<void>(resolve => {
      entered = resolve
    })
    const f = fakeDevice()
    f.hardware.beforeOverride = () => {
      entered()
      return ready
    }
    await f.posture.initialize()
    const applying = f.set('folded')
    await begun
    await assert.rejects(f.set('unfolded'), /already in progress/)
    f.releaseOwner()
    const leaving = f.posture.release()
    await assert.rejects(f.set('unfolded'), /manual reservation/)
    assert.deepEqual(f.overrideCommands(), ['0'])
    finishOverride()
    await Promise.all([applying, leaving])
    assert.deepEqual(f.overrideCommands(), ['0', 'reset'])
    assert.equal(f.posture.mode, 'sensor')
  })

  it('rejects a wrong user or stale reservation without sending any mutation', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    await assert.rejects(f.posture.set('folded', 'other-user', reservation), /manual reservation/)
    await assert.rejects(f.posture.set('folded', manualOwner, 'stale'), /manual reservation/)
    assert.deepEqual(f.overrideCommands(), [])
  })

  it('recovers only an override matching the STF marker on startup', async function() {
    const f = fakeDevice()
    f.hardware.marker = '0'
    f.hardware.override = 0
    f.hardware.committed = 0
    await f.posture.initialize()
    assert.deepEqual(f.overrideCommands(), ['reset'])
    assert.equal(f.hardware.marker, null)
    assert.equal(f.posture.mode, 'sensor')

    const external = fakeDevice()
    external.hardware.marker = '3'
    external.hardware.override = 0
    external.hardware.committed = 0
    await assert.rejects(external.posture.initialize(), /sensor restoration could not be verified/)
    assert.deepEqual(external.overrideCommands(), [])
    assert.equal(external.hardware.override, 0)
    assert.equal(external.posture.mode, null)
  })

  it('leaves a preexisting unmarked override untouched', async function() {
    const f = fakeDevice()
    f.hardware.override = 0
    f.hardware.committed = 0
    await f.posture.initialize()
    await f.posture.release()
    assert.equal(f.posture.mode, null)
    assert.deepEqual(f.overrideCommands(), [])
    assert.equal(f.hardware.override, 0)
  })

  it('uses the platform state identifiers instead of a model-specific mapping', async function() {
    const f = fakeDevice()
    f.hardware.stateNames = ['DEFAULT', 'TENT', 'FOLDED_CUSTOM', 'HALF_OPENED', 'OPEN_CUSTOM']
    f.hardware.resources = {folded: '2\n', unfolded: '4\n'}
    f.hardware.base = f.hardware.committed = 4
    await f.posture.initialize()
    assert.deepEqual(await f.set('folded'), {previous: 4, committed: 2})
    assert.equal(f.hardware.marker, '2')
    assert.deepEqual(await f.set('unfolded'), {previous: 2, committed: 4})
    await f.posture.release()
    assert.deepEqual(f.overrideCommands(), ['2', '4', 'reset'])
  })

  it('does not force an ambiguous firmware mapping', async function() {
    const f = fakeDevice()
    f.hardware.stateNames = ['CLOSED', 'TENT', 'OPENED', 'OPENED']
    await f.posture.initialize()
    await assert.rejects(f.set('folded'), /unavailable/)
    const before = f.commands.length
    await f.posture.prepare(new AbortController().signal)
    assert.equal(f.commands.length, before)
    assert.deepEqual(f.overrideCommands(), [])
  })

  it('rechecks and restores sensor mode before a fresh manual reservation', async function() {
    const f = fakeDevice()
    const {signal} = new AbortController()
    await f.posture.initialize()
    const probes = () => f.commands.filter(args => args[0] === 'dumpsys').length
    const before = probes()
    await f.posture.prepare(signal)
    assert.equal(probes(), before + 1)
    assert.deepEqual(f.overrideCommands(), [])

    await f.set('folded')
    f.releaseOwner()
    await f.posture.prepare(signal)
    assert.equal(f.posture.mode, 'sensor')
    assert.deepEqual(f.overrideCommands(), ['0', 'reset'])
    assert.equal(f.hardware.marker, null)
  })

  it('rejects preparation for an external override without resetting it', async function() {
    const f = fakeDevice()
    const {signal} = new AbortController()
    f.hardware.override = f.hardware.committed = 0
    await f.posture.initialize()
    await assert.rejects(f.posture.prepare(signal), /Unable to confirm Follow hinge/)
    assert.deepEqual(f.overrideCommands(), [])
    assert.equal(f.hardware.override, 0)
    assert.equal(f.posture.mode, null)

    f.hardware.override = null
    f.hardware.committed = f.hardware.base
    await f.posture.prepare(signal)
    assert.equal(f.posture.mode, 'sensor')
    assert.deepEqual(f.overrideCommands(), [])
  })

  it('cancels the preparation probe on shutdown', async function() {
    const f = fakeDevice()
    const shutdown = new AbortController()
    await f.posture.initialize()
    let readStarted!: () => void
    const entered = new Promise<void>(resolve => {
      readStarted = resolve
    })
    f.hardware.beforeDump = signal => new Promise<void>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), {once: true})
      readStarted()
    })
    const preparation = f.posture.prepare(shutdown.signal)
    const preparing = assert.rejects(preparation, /Unable to confirm Follow hinge/)
    await entered
    shutdown.abort()
    await preparing
    assert.deepEqual(f.overrideCommands(), [])
    assert.equal(f.posture.mode, null)
  })

  it('waits for a physical fold already in progress at worker startup', async function() {
    const f = fakeDevice()
    let snapshots = 0
    f.hardware.base = 0
    f.hardware.beforeDump = () => {
      if (++snapshots === 2) {
        f.hardware.committed = f.hardware.base
      }
    }
    await f.posture.initialize()
    assert.equal(f.posture.mode, 'sensor')
    assert.equal(snapshots, 2)
    assert.deepEqual(f.overrideCommands(), [])
  })

  it('uses a transport abort signal on each ADB command without model identity', async function() {
    const f = fakeDevice()
    const signals: AbortSignal[] = []
    const adb = {client: {getDevice: () => ({
      shell: async(args: string[], options: {signal: AbortSignal}) => {
        signals.push(options.signal)
        return Readable.from([Buffer.from(await f.shell(args))])
      }
    })}}
    let managedRotation = false
    const group = {
      isManualOwner: () => true
    , manageManualRotation: () => {
      managedRotation = true
    }
    , beforeManualJoin: () => {}
    , beforeLeave: () => {}
    }
    const posture = await plugin.invoke({serial: 'fixture'}, adb, group) as FoldablePosture
    assert.equal(managedRotation, true)
    await posture.set('folded', manualOwner, reservation)
    await posture.release()
    assert.deepEqual(f.overrideCommands(), ['0', 'reset'])
    assert.equal(signals.length, f.commands.length)
    assert.ok(signals.every(signal => signal instanceof AbortSignal))
  })

  it('does not manage reservations on an ordinary single-state phone', async function() {
    const f = fakeDevice()
    f.hardware.stateNames = ['DEFAULT']
    let hooks = 0
    const adb = {client: {getDevice: () => ({
      shell: async(args: string[]) => Readable.from([Buffer.from(await f.shell(args))])
    })}}
    const group = {
      isManualOwner: () => true
    , manageManualRotation: () => hooks++
    , beforeManualJoin: () => hooks++
    , beforeLeave: () => hooks++
    }
    const posture = await plugin.invoke({serial: 'fixture'}, adb, group) as FoldablePosture
    assert.equal(posture.supported, false)
    assert.equal(hooks, 0)
    assert.ok(!f.commands.some(args => args[1] === 'overlay' || args[0] === 'dumpsys'))
    assert.deepEqual(f.overrideCommands(), [])
  })

  it('keeps ordinary Android ready when foldable probes fail', async function() {
    const errors: unknown[] = []
    const commands: string[][] = []
    const posture = new FoldablePosture(async(args) => {
      commands.push(args)
      throw new Error('ADB probe failed')
    }, () => true, error => errors.push(error))
    await posture.initialize()
    assert.equal(posture.supported, false)
    assert.equal(posture.mode, null)
    const probes = commands.map(args => args.slice(0, 2))
    assert.deepEqual(probes, [['cmd', 'device_state'], ['sh', '-c']])
    assert.equal(errors.length, 2)
  })
})
