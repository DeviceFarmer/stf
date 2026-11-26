import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import plugin, {Fold4Posture} from '../../lib/units/device/plugins/fold4-posture.js'
import type {Fold4PostureMode} from '../../lib/types/android-display.js'

const manualOwner = 'operator@example.test'
const reservation = 'current-reservation'
const names = ['CLOSED', 'TENT', 'HALF_OPENED', 'OPENED', 'CONCURRENT_INNER', 'CONCURRENT_OUTER']

function fakeDevice() {
  const commands: string[][] = []
  const hardware = {
    marker: null as string | null
    , override: null as number | null
    , base: 3
    , committed: 3
    , refuseReset: false
    , confirmOverride: true
    , stateNames: names
    , beforeOverride: () => Promise.resolve()
    , beforeDump: () => {}
  }
  const record = (id: number) =>
    `DeviceState{identifier=${id}, name='${names[id]}', app_accessible=true}`
  const shell = async(args: string[]) => {
    commands.push(args)
    if (args[0] === 'sh') {
      if (args.length === 6) {
        hardware.marker = args[5]!
        return ''
      }
      return hardware.marker ?? 'absent\n'
    }
    if (args[0] === 'rm') {
      hardware.marker = null
      return ''
    }
    if (args[0] === 'dumpsys') {
      hardware.beforeDump()
      const base = `mBaseState=Optional[${record(hardware.base)}]`
      const override = hardware.override === null ? 'Optional.empty' :
        `Optional[${record(hardware.override)}]`
      return `  ${base}\n  mOverrideState=${override}\n`
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
  const changes: Array<Fold4PostureMode | null> = []
  const posture = new Fold4Posture(shell, (email, id) =>
    email === manualOwner && id === reservation && !leaving, error => errors.push(error))
  posture.on('change', mode => changes.push(mode))
  const set = (mode: Fold4PostureMode) => posture.set(mode, manualOwner, reservation)
  const overrideCommands = () => commands.filter(args => args[2] === 'state').map(args => args[3])
  return {commands, hardware, changes, errors, posture, set, releaseOwner, overrideCommands, shell}
}

describe('Galaxy Z Fold4 provider posture', function() {
  it('uses the tested commands and verifies sensor control on leave', async function() {
    const f = fakeDevice()
    await f.posture.initialize()
    await f.set('folded')
    assert.equal(f.hardware.marker, '0')
    await f.set('unfolded')
    assert.equal(f.hardware.marker, '3')
    f.releaseOwner()
    await f.posture.release()
    assert.deepEqual(f.overrideCommands(), ['0', '3', 'reset'])
    assert.deepEqual(f.changes, ['sensor', 'folded', 'unfolded', 'sensor'])
    assert.equal(f.hardware.override, null)
    assert.equal(f.hardware.marker, null)
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

  it('does not force an unverified firmware mapping', async function() {
    const f = fakeDevice()
    f.hardware.stateNames = ['OPENED', 'TENT', 'HALF_OPENED', 'CLOSED']
    await f.posture.initialize()
    await assert.rejects(f.set('folded'), /unavailable/)
    assert.deepEqual(f.overrideCommands(), [])
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

  it('uses a transport abort signal on each Fold4 ADB command', async function() {
    const f = fakeDevice()
    const signals: AbortSignal[] = []
    const adb = {client: {getDevice: () => ({
      shell: async(args: string[], options: {signal: AbortSignal}) => {
        signals.push(options.signal)
        return Readable.from([Buffer.from(await f.shell(args))])
      }
    })}}
    const group = {isManualOwner: () => true, beforeLeave: () => {}}
    const identity = {manufacturer: 'SAMSUNG', model: 'SM-F936B'}
    const posture = await plugin.invoke({serial: 'fixture'}, adb, group, identity) as Fold4Posture
    await posture.set('folded', manualOwner, reservation)
    await posture.release()
    assert.deepEqual(f.overrideCommands(), ['0', 'reset'])
    assert.equal(signals.length, f.commands.length)
    assert.ok(signals.every(signal => signal instanceof AbortSignal))
  })
})
