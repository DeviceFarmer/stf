import {EventEmitter} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import syrup from '@devicefarmer/stf-syrup'

import type {Fold4PostureMode} from '../../../types/android-display.js'
import type {
  Adb, DeviceIdentity, DevicePluginOptions, GroupPlugin
} from '../../../types/device-plugins.js'
import logger from '../../../util/logger.js'
import streamutil from '../../../util/streamutil.js'
import adbSyrup from '../support/adb.js'
import groupSyrup from './group.js'
import identitySyrup from './util/identity.js'

const markerPath = '/data/local/tmp/stf-fold4-posture-v1'
const shellTimeoutMs = 1200
const preparationTimeoutMs = 3500
const stateCommand = ['cmd', 'device_state']
const rotationCommand = ['wm', 'user-rotation']
const fixedRotationCommand = ['wm', 'fixed-to-user-rotation']
const overrideIds = {folded: 0, unfolded: 3} as const
type OverrideId = typeof overrideIds[keyof typeof overrideIds]
type Shell = (args: string[], signal?: AbortSignal) => Promise<string>
type RotationMode = 'free' | `lock ${0 | 1 | 2 | 3}`
type FixedRotationMode = 'default' | 'disabled' | 'enabled' | 'enabled_if_no_auto_rotation'

interface Fold4State {
  base: number
  committed: number
  override: number | null
}

function supportedStates(output: string) {
  const entries = [...output.matchAll(/DeviceState\{identifier=(\d+), name='([^']+)'[,}]/g)]
  const closed = entries.filter(row => row[1] === '0' || row[2] === 'CLOSED')
  const opened = entries.filter(row => row[1] === '3' || row[2] === 'OPENED')
  return closed.length === 1 && closed[0]?.[1] === '0' && closed[0]?.[2] === 'CLOSED' &&
    opened.length === 1 && opened[0]?.[1] === '3' && opened[0]?.[2] === 'OPENED'
}

function isSensor(state: Fold4State) {
  return state.override === null && state.base === state.committed
}

function confirmedPanel(state: Fold4State): Exclude<Fold4PostureMode, 'sensor'> | null {
  if (state.committed === overrideIds.folded) {
    return 'folded'
  }
  return state.committed === overrideIds.unfolded ? 'unfolded' : null
}

class ExternalOverrideError extends Error {
  constructor() {
    super('An external Fold4 posture override is active')
  }
}

export class Fold4Posture extends EventEmitter<{change: [mode: Fold4PostureMode | null]}> {
  private capable = false
  private currentMode: Fold4PostureMode | null = null
  private owned: readonly OverrideId[] = []
  private markerMayExist = false
  private pending: Promise<Fold4State> | null = null
  private rotationPending: Promise<void> | null = null
  private rotationPolicy: {initial: RotationMode, applied: RotationMode} | null = null
  private initialFixedRotation: FixedRotationMode | null = null

  constructor(
    private readonly shell: Shell
  , private readonly isManualOwner: GroupPlugin['isManualOwner']
  , private readonly report: (error: unknown) => void
  ) {
    super()
  }

  get mode() {
    return this.currentMode
  }

  get supported() {
    return this.capable
  }

  async initialize() {
    const marker = await this.readMarker()
    let canOverride: boolean
    try {
      canOverride = supportedStates(await this.shell([...stateCommand, 'print-states']))
    }
    catch (error) {
      if (marker) {
        throw error
      }
      this.report(error)
      return
    }
    if (!canOverride) {
      if (marker) {
        throw new Error('Cannot recover the STF Fold4 override with unknown state identifiers')
      }
      return
    }
    this.capable = true

    if (marker) {
      this.markerMayExist = true
      this.owned = marker
      await this.restoreSensor()
    }
    else {
      try {
        await this.waitForState(isSensor)
        this.publish('sensor')
      }
      catch (error) {
        this.report(error)
      }
    }
  }

  async prepare(shutdown: AbortSignal) {
    if (!this.capable) {
      return
    }
    const signal = AbortSignal.any([shutdown, AbortSignal.timeout(preparationTimeoutMs)])
    try {
      if (this.markerMayExist) {
        await this.restoreSensor(signal)
      }
      else {
        // Verify the current sensor state even when it was already active at startup.
        await this.waitForState(isSensor, signal)
        this.publish('sensor')
      }
    }
    catch (error) {
      this.publish(null)
      this.report(error)
      throw new Error('Unable to confirm Follow hinge on Galaxy Z Fold4', {cause: error})
    }
  }

  async set(mode: Fold4PostureMode, requester: string, reservationId: string) {
    if (mode !== 'sensor' && mode !== 'folded' && mode !== 'unfolded') {
      throw new Error('Invalid Fold4 posture')
    }
    if (!this.isManualOwner(requester, reservationId)) {
      throw new Error('A current manual reservation is required for Fold4 posture')
    }
    if (this.pending) {
      throw new Error('A Fold4 posture change is already in progress')
    }
    if (!this.mode && !(mode === 'sensor' && this.markerMayExist)) {
      throw new Error('Fold4 posture control is unavailable')
    }
    const operation = mode === 'sensor' ?
      this.restoreSensor() : this.force(mode, requester, reservationId)
    this.pending = operation
    try {
      return confirmedPanel(await operation)
    }
    finally {
      this.pending = null
    }
  }

  async release() {
    // The group marks itself as leaving before calling this hook. No new
    // owner or posture command can enter while the current operation drains.
    await this.pending?.catch(() => null)
    await this.rotationPending?.catch(() => null)
    if (this.markerMayExist) {
      await this.restoreSensor()
    }
    if (this.initialFixedRotation) {
      if (this.initialFixedRotation !== 'enabled' && await this.readFixedRotation() === 'enabled') {
        await this.applyRotationMode(fixedRotationCommand, this.initialFixedRotation)
      }
      this.initialFixedRotation = null
    }
    if (this.rotationPolicy) {
      const {initial, applied} = this.rotationPolicy
      if (initial !== applied && await this.readRotation() === applied) {
        await this.applyRotationMode(rotationCommand, initial)
      }
      this.rotationPolicy = null
    }
  }

  async rotate(rotation: number, requester: string, reservationId: string) {
    if (!this.supported || !this.isManualOwner(requester, reservationId)) {
      throw new Error('A current manual reservation is required for Fold4 rotation')
    }
    if (this.rotationPending || ![0, 90, 180, 270].includes(rotation)) {
      throw new Error('Invalid or overlapping Fold4 rotation')
    }
    const applied = `lock ${rotation / 90 as 0 | 1 | 2 | 3}` as const
    const operation = this.readRotation().then(async current => {
      const fixed = await this.readFixedRotation()
      if (!this.isManualOwner(requester, reservationId)) {
        throw new Error('Fold4 rotation reservation changed')
      }
      const previous = this.rotationPolicy
      const initial = previous?.applied === current ? previous.initial : current
      if (!this.initialFixedRotation || fixed !== 'enabled') {
        this.initialFixedRotation = fixed
      }
      this.rotationPolicy = {initial, applied}
      if (current !== applied) {
        await this.applyRotationMode(rotationCommand, applied)
      }
      if (fixed !== 'enabled') {
        // A screen such as the launcher may request portrait despite the user rotation lock.
        await this.applyRotationMode(fixedRotationCommand, 'enabled')
      }
    })
    this.rotationPending = operation
    try {
      await operation
    }
    finally {
      this.rotationPending = null
    }
  }

  private async readRotation(): Promise<RotationMode> {
    const current = (await this.shell(rotationCommand)).trim()
    if (current === 'free' || current === 'lock 0' || current === 'lock 1' ||
      current === 'lock 2' || current === 'lock 3') {
      return current
    }
    throw new Error('Unable to read the Fold4 rotation policy')
  }

  private async readFixedRotation(): Promise<FixedRotationMode> {
    const current = (await this.shell(fixedRotationCommand)).trim()
    if (current === 'default' || current === 'disabled' || current === 'enabled' ||
      current === 'enabled_if_no_auto_rotation') {
      return current
    }
    throw new Error('Unable to read the Fold4 display rotation policy')
  }

  private async applyRotationMode(command: string[], mode: RotationMode | FixedRotationMode) {
    const output = await this.shell([...command, ...mode.split(' ')])
    if (output.trim() || (await this.shell(command)).trim() !== mode) {
      throw new Error('Android did not confirm the Fold4 rotation policy')
    }
  }

  private async force(
    mode: Exclude<Fold4PostureMode, 'sensor'>, requester: string, reservationId: string
  ) {
    const expected = overrideIds[mode]
    const state = await this.readState()
    this.assertOwnedOverride(state)
    if (state.committed === expected && state.override === expected) {
      this.publish(mode)
      return state
    }
    if (!this.isManualOwner(requester, reservationId)) {
      throw new Error('Fold4 posture reservation changed')
    }
    try {
      // A restart during the transition can encounter the last confirmed
      // override or the replacement request, both issued by this provider.
      const candidates = state.override === null ?
        [expected] : [...new Set([...this.owned, expected])]
      await this.writeMarker(candidates)
      if (!this.isManualOwner(requester, reservationId)) {
        throw new Error('Fold4 posture reservation changed')
      }
      const output = await this.shell([...stateCommand, 'state', String(expected)])
      if (output.trim()) {
        throw new Error('Android rejected the Fold4 posture command')
      }
      const confirmed = await this.waitForState(actual =>
        actual.committed === expected && actual.override === expected)
      if (candidates.length > 1) {
        await this.writeMarker([expected])
      }
      this.publish(mode)
      return confirmed
    }
    catch (error) {
      try {
        await this.restoreSensor()
      }
      catch (cleanupError) {
        this.report(cleanupError)
        throw new Error('Fold4 posture change failed and sensor restoration could not be verified',
          {cause: error})
      }
      throw error
    }
  }

  private async restoreSensor(signal?: AbortSignal) {
    let failure: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        signal?.throwIfAborted()
        const state = await this.readState(signal)
        this.assertOwnedOverride(state)
        if (state.override !== null) {
          await this.shell([...stateCommand, 'state', 'reset'], signal)
        }
        else if (this.markerMayExist && isSensor(state)) {
          // An interrupted request can still be completing on the device.
          await delay(120, null, signal ? {signal} : {})
        }
        const confirmed = this.markerMayExist || !isSensor(state) ?
          await this.waitForState(isSensor, signal) : state
        if (this.markerMayExist) {
          await this.shell(['rm', '-f', markerPath, `${markerPath}.tmp`], signal)
          if (await this.readMarker(signal)) {
            throw new Error('Unable to clear the STF Fold4 posture marker')
          }
        }
        signal?.throwIfAborted()
        this.markerMayExist = false
        this.owned = []
        this.publish('sensor')
        return confirmed
      }
      catch (error) {
        signal?.throwIfAborted()
        failure = error
        if (error instanceof ExternalOverrideError) {
          break
        }
      }
    }
    this.publish(null)
    throw new Error('Fold4 sensor restoration could not be verified', {cause: failure})
  }

  private async waitForState(check: (state: Fold4State) => boolean, signal?: AbortSignal) {
    for (let attempt = 0; attempt < 4; attempt++) {
      signal?.throwIfAborted()
      const state = await this.readState(signal)
      signal?.throwIfAborted()
      this.assertOwnedOverride(state)
      if (check(state)) {
        return state
      }
      if (attempt < 3) {
        await delay(120, null, signal ? {signal} : {})
      }
    }
    throw new Error('Android did not confirm the requested Fold4 posture')
  }

  private assertOwnedOverride(state: Fold4State) {
    const id = state.override
    if (id !== null && !this.owned.some(owned => owned === id)) {
      this.publish(null)
      throw new ExternalOverrideError()
    }
  }

  private async readState(signal?: AbortSignal): Promise<Fold4State> {
    const dump = await this.shell(['dumpsys', 'device_state'], signal)
    const base = /^\s*mBaseState=Optional\[DeviceState\{identifier=(\d+),/m.exec(dump)
    const overridePattern =
      /^\s*mOverrideState=Optional(?:\.empty\b|\[DeviceState\{identifier=(\d+),)/m
    const override = overridePattern.exec(dump)
    const committed = (await this.shell([...stateCommand, 'print-state'], signal)).trim()
    if (!base || !override || !/^\d+$/.test(committed)) {
      throw new Error('Unable to read the Fold4 device state')
    }
    return {base: Number(base[1]), committed: Number(committed)
      , override: override[1] ? Number(override[1]) : null}
  }

  private async readMarker(signal?: AbortSignal): Promise<OverrideId[] | null> {
    const script = 'if [ -e "$1" ]; then cat "$1"; else printf "absent\\n"; fi'
    const output = (await this.shell(['sh', '-c', script, 'stf-marker', markerPath], signal)).trim()
    if (output === 'absent') {
      return null
    }
    if (!/^(?:0|3|0,3|3,0)$/.test(output)) {
      throw new Error('Invalid STF Fold4 posture marker')
    }
    return output.split(',').map(id => id === '0' ? 0 : 3)
  }

  private async writeMarker(ids: readonly OverrideId[]) {
    this.markerMayExist = true
    const marker = ids.join(',')
    // These are fixed shell arguments. The payload contains only verified
    // device state IDs, never a request parameter or an owner identity.
    const script = 'umask 077; printf "%s\\n" "$2" > "$1.tmp" && mv -f "$1.tmp" "$1"'
    await this.shell(['sh', '-c', script, 'stf-marker', markerPath, marker])
    if ((await this.readMarker())?.join(',') !== marker) {
      throw new Error('Unable to write the STF Fold4 posture marker')
    }
    this.owned = ids
  }

  private publish(next: Fold4PostureMode | null) {
    if (this.currentMode !== next) {
      this.currentMode = next
      this.emit('change', next)
    }
  }
}

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(groupSyrup)
  .dependency(identitySyrup)
  .define(async function(
    options: DevicePluginOptions, adb: Adb, group: GroupPlugin, identity: DeviceIdentity
  ) {
    const log = logger.createLogger('device:plugins:fold4-posture')
    const shell: Shell = async(args, parentSignal) => {
      const timeout = AbortSignal.timeout(shellTimeoutMs)
      const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout
      const stream = await adb.client.getDevice(options.serial).shell(args, {signal})
      try {
        return (await streamutil.readAll(stream)).toString()
      }
      finally {
        stream.destroy()
      }
    }
    const posture = new Fold4Posture(shell, group.isManualOwner, error => log.warn('%s', error))
    if (identity.manufacturer.toUpperCase() === 'SAMSUNG' && identity.model === 'SM-F936B') {
      const ready = posture.initialize()
      group.beforeManualJoin(async signal => {
        await ready
        await posture.prepare(signal)
      })
      group.beforeLeave(async() => {
        await ready
        await posture.release()
      })
      await ready
    }
    return posture
  })
