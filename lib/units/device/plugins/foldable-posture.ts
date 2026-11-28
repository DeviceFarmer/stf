import {EventEmitter} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import syrup from '@devicefarmer/stf-syrup'

import type {FoldablePostureMode} from '../../../types/android-display.js'
import type {Adb, DevicePluginOptions, GroupPlugin} from '../../../types/device-plugins.js'
import logger from '../../../util/logger.js'
import streamutil from '../../../util/streamutil.js'
import adbSyrup from '../support/adb.js'
import groupSyrup from './group.js'
import {isDeviceStateId, parseFoldableStates, type FoldableStates} from './foldable-states.js'

// Keep recovery of overrides left by the original Fold4 implementation.
const postureMarkerPath = '/data/local/tmp/stf-fold4-posture-v1'
const rotationMarkerPath = '/data/local/tmp/stf-foldable-rotation-v1'
const shellTimeoutMs = 1200
const preparationTimeoutMs = 3500
const stateCommand = ['cmd', 'device_state']
const overlayLookup = ['cmd', 'overlay', 'lookup', 'android']
const rotationCommand = ['wm', 'user-rotation']
const fixedRotationCommand = ['wm', 'fixed-to-user-rotation']
type Shell = (args: string[], signal?: AbortSignal) => Promise<string>
type RotationLock = `lock ${0 | 1 | 2 | 3}`
type RotationMode = 'free' | RotationLock
type FixedRotationMode = 'default' | 'disabled' | 'enabled' | 'enabled_if_no_auto_rotation'

interface FoldableState {
  base: number
  committed: number
  override: number | null
}

export interface PostureTransition {
  previous: number | null
  committed: number
}

interface RotationRecovery {
  rotation: {initial: RotationMode, applied: RotationLock[]} | null
  fixed: Exclude<FixedRotationMode, 'enabled'> | null
}

function isSensor(state: FoldableState) {
  return state.override === null && state.base === state.committed
}

function isRotationLock(value: unknown): value is RotationLock {
  return typeof value === 'string' && /^lock [0-3]$/.test(value)
}

function isRotationMode(value: unknown): value is RotationMode {
  return value === 'free' || isRotationLock(value)
}

function isFixedRotationMode(value: unknown): value is FixedRotationMode {
  return value === 'default' || value === 'disabled' || value === 'enabled' ||
    value === 'enabled_if_no_auto_rotation'
}

class ExternalOverrideError extends Error {
  constructor() {
    super('An external foldable posture override is active')
  }
}

export class FoldablePosture extends EventEmitter<{change: [mode: FoldablePostureMode | null]}> {
  private states: FoldableStates | null = null
  private currentMode: FoldablePostureMode | null = null
  private owned: readonly number[] = []
  private markerMayExist = false
  private pending: Promise<PostureTransition> | null = null
  private rotationPending: Promise<void> | null = null
  private rotationRecovery: RotationRecovery | null = null

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
    return this.states !== null
  }

  async initialize() {
    const [discovery, saved] = await Promise.allSettled([this.detectStates(), this.readMarker()])
    if (discovery.status === 'rejected') {
      throw discovery.reason
    }
    const states = discovery.value
    if (saved.status === 'rejected') {
      if (states) {
        throw saved.reason
      }
      this.report(saved.reason)
      return
    }
    const marker = saved.value
    if (!states) {
      if (marker) {
        throw new Error('Cannot recover the STF foldable override with unknown state identifiers')
      }
      return
    }
    this.states = states
    this.rotationRecovery = await this.readRotationRecovery()

    if (marker) {
      if (marker.some(id => id !== states.folded && id !== states.unfolded)) {
        throw new Error('Cannot recover the STF foldable override with unknown state identifiers')
      }
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
    await this.restoreRotation()
  }

  private async detectStates(): Promise<FoldableStates | null> {
    try {
      const output = await this.shell([...stateCommand, 'print-states'])
      if ((output.match(/DeviceState\{identifier=/g)?.length ?? 0) < 2) {
        return null
      }
      const lookup = (resource: string) =>
        this.shell([...overlayLookup, resource]).catch(() => '')
      const [folded, unfolded] = await Promise.all([
        lookup('android:array/config_foldedDeviceStates')
        , lookup('android:array/config_openDeviceStates')
      ])
      return parseFoldableStates(output, {folded, unfolded})
    }
    catch (error) {
      this.report(error)
      return null
    }
  }

  async prepare(shutdown: AbortSignal) {
    if (!this.supported) {
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
      throw new Error('Unable to confirm Follow hinge on this device', {cause: error})
    }
  }

  async set(mode: FoldablePostureMode, requester: string, reservationId: string) {
    if (mode !== 'sensor' && mode !== 'folded' && mode !== 'unfolded') {
      throw new Error('Invalid foldable posture')
    }
    if (!this.isManualOwner(requester, reservationId)) {
      throw new Error('A current manual reservation is required for foldable posture')
    }
    if (this.pending) {
      throw new Error('A foldable posture change is already in progress')
    }
    const states = this.states
    if (!states || (!this.mode && !(mode === 'sensor' && this.markerMayExist))) {
      throw new Error('Foldable posture control is unavailable')
    }
    const operation = mode === 'sensor' ?
      this.restoreSensor() : this.force(mode, states[mode], requester, reservationId)
    this.pending = operation
    try {
      return await operation
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
    await this.restoreRotation()
  }

  async rotate(rotation: number, requester: string, reservationId: string) {
    if (!this.supported || !this.isManualOwner(requester, reservationId)) {
      throw new Error('A current manual reservation is required for foldable rotation')
    }
    if (this.rotationPending || ![0, 90, 180, 270].includes(rotation)) {
      throw new Error('Invalid or overlapping foldable rotation')
    }
    const applied = `lock ${rotation / 90 as 0 | 1 | 2 | 3}` as const
    const operation = this.readRotation().then(async current => {
      const fixed = await this.readFixedRotation()
      if (!this.isManualOwner(requester, reservationId)) {
        throw new Error('Foldable rotation reservation changed')
      }

      const previous = this.rotationRecovery?.rotation
      const previousLock = isRotationLock(current) && previous?.applied.includes(current) ?
        current : null
      const initial = previousLock && previous ? previous.initial : current
      const initialFixed = fixed === 'enabled' ? this.rotationRecovery?.fixed ?? null : fixed
      const confirmed = initial === applied ? [] : [applied]
      const candidates = previousLock && previousLock !== applied ?
        [previousLock, ...confirmed] : confirmed
      // Record both possible results before the command. The ADB connection can
      // fail before delivery or after Android applied the new angle.
      await this.saveRotationRecovery({
        rotation: candidates.length ? {initial, applied: candidates} : null
      , fixed: initialFixed
      })
      if (!this.isManualOwner(requester, reservationId)) {
        throw new Error('Foldable rotation reservation changed')
      }
      if (current !== applied) {
        await this.applyRotationMode(rotationCommand, applied)
      }
      if (candidates.length !== confirmed.length) {
        await this.saveRotationRecovery({
          rotation: confirmed.length ? {initial, applied: confirmed} : null
        , fixed: initialFixed
        })
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
    if (isRotationMode(current)) {
      return current
    }
    throw new Error('Unable to read the foldable rotation policy')
  }

  private async readFixedRotation(): Promise<FixedRotationMode> {
    const current = (await this.shell(fixedRotationCommand)).trim()
    if (isFixedRotationMode(current)) {
      return current
    }
    throw new Error('Unable to read the foldable display rotation policy')
  }

  private async applyRotationMode(command: string[], mode: RotationMode | FixedRotationMode) {
    const output = await this.shell([...command, ...mode.split(' ')])
    if (output.trim() || (await this.shell(command)).trim() !== mode) {
      throw new Error('Android did not confirm the foldable rotation policy')
    }
  }

  private async restoreRotation() {
    const saved = this.rotationRecovery
    if (!saved) {
      return
    }
    if (saved.fixed && await this.readFixedRotation() === 'enabled') {
      await this.applyRotationMode(fixedRotationCommand, saved.fixed)
    }
    if (saved.rotation) {
      const current = await this.readRotation()
      if (isRotationLock(current) && saved.rotation.applied.includes(current)) {
        await this.applyRotationMode(rotationCommand, saved.rotation.initial)
      }
    }
    await this.saveRotationRecovery({rotation: null, fixed: null})
  }

  private async readRotationRecovery(): Promise<RotationRecovery | null> {
    const marker = await this.readMarkerFile(rotationMarkerPath)
    if (marker === null) {
      return null
    }
    const saved = JSON.parse(marker) as RotationRecovery | null
    const fixed: unknown = saved?.fixed
    const rotation = saved?.rotation
    const initial: unknown = rotation?.initial
    const applied: unknown = rotation?.applied
    if (!saved || (fixed !== null && (!isFixedRotationMode(fixed) || fixed === 'enabled')) ||
      (rotation !== null && (!isRotationMode(initial) || !Array.isArray(applied) ||
        !applied.length || applied.length > 2 || !applied.every(isRotationLock) ||
        new Set(applied).size !== applied.length ||
        (isRotationLock(initial) && applied.includes(initial)))) ||
      (rotation === null && fixed === null)) {
      throw new Error('Invalid STF foldable rotation marker')
    }
    return {rotation: saved.rotation, fixed}
  }

  private async saveRotationRecovery(recovery: RotationRecovery) {
    if (!recovery.rotation && !recovery.fixed) {
      if (this.rotationRecovery) {
        await this.removeMarkerFile(rotationMarkerPath)
      }
      this.rotationRecovery = null
      return
    }
    await this.writeMarkerFile(rotationMarkerPath, JSON.stringify(recovery))
    this.rotationRecovery = recovery
  }

  private async force(
    mode: Exclude<FoldablePostureMode, 'sensor'>
  , expected: number
  , requester: string
  , reservationId: string
  ) {
    const state = await this.readState()
    this.assertOwnedOverride(state)
    if (state.committed === expected && state.override === expected) {
      this.publish(mode)
      return {previous: state.committed, committed: state.committed}
    }
    if (!this.isManualOwner(requester, reservationId)) {
      throw new Error('Foldable posture reservation changed')
    }
    try {
      // A restart during the transition can encounter the last confirmed
      // override or the replacement request, both issued by this provider.
      const candidates = state.override === null ?
        [expected] : [...new Set([...this.owned, expected])]
      await this.writeMarker(candidates)
      if (!this.isManualOwner(requester, reservationId)) {
        throw new Error('Foldable posture reservation changed')
      }
      const output = await this.shell([...stateCommand, 'state', String(expected)])
      if (output.trim()) {
        throw new Error('Android rejected the foldable posture command')
      }
      const confirmed = await this.waitForState(actual =>
        actual.committed === expected && actual.override === expected)
      if (candidates.length > 1) {
        await this.writeMarker([expected])
      }
      this.publish(mode)
      return {previous: state.committed, committed: confirmed.committed}
    }
    catch (error) {
      try {
        await this.restoreSensor()
      }
      catch (cleanupError) {
        this.report(cleanupError)
        throw new Error(
          'Foldable posture change failed and sensor recovery was not verified', {cause: error}
        )
      }
      throw error
    }
  }

  private async restoreSensor(signal?: AbortSignal) {
    let failure: unknown
    let previous: number | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        signal?.throwIfAborted()
        const state = await this.readState(signal)
        if (attempt === 0) {
          previous = state.committed
        }
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
          await this.removeMarkerFile(postureMarkerPath, signal)
        }
        signal?.throwIfAborted()
        this.markerMayExist = false
        this.owned = []
        this.publish('sensor')
        return {previous, committed: confirmed.committed}
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
    throw new Error('Foldable sensor restoration could not be verified', {cause: failure})
  }

  private async waitForState(check: (state: FoldableState) => boolean, signal?: AbortSignal) {
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
    throw new Error('Android did not confirm the requested foldable posture')
  }

  private assertOwnedOverride(state: FoldableState) {
    const id = state.override
    if (id !== null && !this.owned.some(owned => owned === id)) {
      this.publish(null)
      throw new ExternalOverrideError()
    }
  }

  private async readState(signal?: AbortSignal): Promise<FoldableState> {
    const dump = await this.shell(['dumpsys', 'device_state'], signal)
    const base = /^\s*mBaseState=Optional\[DeviceState\{identifier=(\d+),/m.exec(dump)
    const overridePattern =
      /^\s*mOverrideState=Optional(?:\.empty\b|\[DeviceState\{identifier=(\d+),)/m
    const override = overridePattern.exec(dump)
    const committedPattern = /^\s*mCommittedState=Optional\[DeviceState\{identifier=(\d+),/m
    const committed = committedPattern.exec(dump)?.[1] ??
      (await this.shell([...stateCommand, 'print-state'], signal)).trim()
    const read = {base: Number(base?.[1]), committed: Number(committed)
      , override: override?.[1] ? Number(override[1]) : null}
    if (!override || !/^\d+$/.test(committed) ||
      !isDeviceStateId(read.base) || !isDeviceStateId(read.committed) ||
      (read.override !== null && !isDeviceStateId(read.override))) {
      throw new Error('Unable to read the foldable device state')
    }
    return read
  }

  private async readMarkerFile(path: string, signal?: AbortSignal): Promise<string | null> {
    const script = 'if [ -e "$1" ]; then head -c 513 "$1"; else printf "absent\\n"; fi'
    const marker = await this.shell(['sh', '-c', script, 'stf-marker', path], signal)
    if (marker.length > 512) {
      throw new Error('STF foldable recovery marker is too long')
    }
    const output = marker.trim()
    return output === 'absent' ? null : output
  }

  private async readMarker(): Promise<number[] | null> {
    const marker = await this.readMarkerFile(postureMarkerPath)
    if (marker === null) {
      return null
    }
    const ids = marker.split(',').map(Number)
    if (!/^\d{1,5}(?:,\d{1,5})?$/.test(marker) || new Set(ids).size !== ids.length ||
      !ids.every(isDeviceStateId)) {
      throw new Error('Invalid STF foldable posture marker')
    }
    return ids
  }

  private async writeMarker(ids: readonly number[]) {
    this.markerMayExist = true
    // These are fixed shell arguments. The payload contains only verified
    // device state IDs, never a request parameter or an owner identity.
    await this.writeMarkerFile(postureMarkerPath, ids.join(','))
    this.owned = ids
  }

  private async writeMarkerFile(path: string, marker: string) {
    const script = 'umask 077; printf "%s\\n" "$2" > "$1.tmp" && mv -f "$1.tmp" "$1"'
    await this.shell(['sh', '-c', script, 'stf-marker', path, marker])
    if (await this.readMarkerFile(path) !== marker) {
      throw new Error('Unable to write the STF foldable recovery marker')
    }
  }

  private async removeMarkerFile(path: string, signal?: AbortSignal) {
    await this.shell(['rm', '-f', path, `${path}.tmp`], signal)
    if (await this.readMarkerFile(path, signal) !== null) {
      throw new Error('Unable to clear the STF foldable recovery marker')
    }
  }

  private publish(next: FoldablePostureMode | null) {
    if (this.currentMode !== next) {
      this.currentMode = next
      this.emit('change', next)
    }
  }
}

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(groupSyrup)
  .define(async function(
    options: DevicePluginOptions, adb: Adb, group: GroupPlugin
  ) {
    const log = logger.createLogger('device:plugins:foldable-posture')
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
    const posture = new FoldablePosture(shell, group.isManualOwner, error => log.warn('%s', error))
    await posture.initialize()
    if (posture.supported) {
      group.manageManualRotation()
      group.beforeManualJoin(signal => posture.prepare(signal))
      group.beforeLeave(() => posture.release())
    }
    return posture
  })
