import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

import syrup from '@devicefarmer/stf-syrup'
import EventEmitter from 'eventemitter3'

import logger from '../../../../util/logger.js'
import streamutil from '../../../../util/streamutil.js'
import {computeDisplaySize} from '../../../../util/displayutil.js'
import type Bluebird from 'bluebird'
import type {AndroidDisplayTarget} from '../../../../types/android-display.js'
import type {
  Adb
, DisplayEvents
, DisplayProperties
, DevicePluginOptions
, MinicapResource
, ScreenOptions
, ServicePlugin
} from '../../../../types/device-plugins.js'
import adbSyrup from '../../support/adb.js'
import minicapSyrup from '../../resources/minicap.js'
import serviceSyrup from '../service.js'
import optionsSyrup from '../screen/options.js'

const log = logger.createLogger('device:plugins:display')
const primaryDisplayId = 0
const displaySampleIntervalMs = 120
const displaySettleTimeoutMs = 2500
const displayShellTimeoutMs = 2000

type DozeState = 'DOZE' | 'DOZE_SUSPEND'

interface PhysicalDisplayAddress {
  port: number
  model?: string | undefined
}

interface DisplayGeometry extends Omit<AndroidDisplayTarget, 'revision'> {
  readonly uniqueId?: string | undefined
  readonly address?: PhysicalDisplayAddress
  readonly doze?: {
    readonly state: DozeState
    readonly committed: DozeState | 'UNKNOWN'
  }
}

interface AndroidDisplayEvents extends DisplayEvents {
  change: [target: AndroidDisplayTarget]
  transition: []
}

function naturalGeometry(id: number, width: number, height: number, quarterTurns: number) {
  const sideways = quarterTurns === 1 || quarterTurns === 3
  return {
    id
  , width: sideways ? height : width
  , height: sideways ? width : height
  , rotation: quarterTurns * 90
  }
}

function parsePhysicalAddress(value: string): PhysicalDisplayAddress | null {
  const address = /^\{port=(\d{1,3})(?:, model=(0x[\da-f]+))?\}$/i.exec(value)
  const port = Number(address?.[1])
  return address && port <= 255 ? {port, model: address[2]?.toLowerCase()} : null
}

export function parsePrimaryDisplayLayout(
  output: string, state: number
): PhysicalDisplayAddress | null {
  const prefix = `state(${state}):`
  const rows = output.split('\n').filter(line => line.trimStart().startsWith(prefix))
  if (rows.length !== 1) {
    return null
  }
  // Older Android releases print the address before the display ID.
  const records = rows[0]!.match(/\{(?:[^{}]|\{[^{}]*\})*\}/g) ?? []
  const enabledPrimary = records.filter(record => /\bdispId:\s*0\(ON\)(?=[,}])/.test(record))
  const address = enabledPrimary.length === 1 &&
    /\baddr:\s*(\{[^{}]*\})/.exec(enabledPrimary[0]!)?.[1]
  return address ? parsePhysicalAddress(address) : null
}

export function parsePrimaryDisplay(output: string, allowDoze = false): DisplayGeometry | null {
  const line = output.split('\n').map(row => row.trim()).find(row =>
    row.startsWith('Display id 0: ') && row.endsWith('isValid=true'))
  return line ? parsePrimaryDisplayInfo(line.slice('Display id 0: '.length), allowDoze) : null
}

function parsePrimaryDisplayDump(output: string, allowDoze: boolean): DisplayGeometry | null {
  const sections = output.split(/^[ \t]+Logical Displays: size=\d+[ \t]*\r?$/m)
  if (sections.length !== 2) {
    return null
  }
  const logical = sections[1]!.split(/^\S.*$/m, 1)[0]!
  const primary = logical.split(/^[ \t]+Display 0:[ \t]*\r?$/m)
  if (primary.length !== 2) {
    return null
  }
  const fields = primary[1]!.split(/^[ \t]+Display \d+:/m, 1)[0]!
  const active = /^[ \t]+mDisplayId=0[ \t]*\r?$/m.test(fields) &&
    /^[ \t]+mPhase=1[ \t]*\r?$/m.test(fields) &&
    /^[ \t]+mPrimaryDisplayDevice=(?!null[ \t]*\r?$)\S/m.test(fields)
  const base = /^[ \t]+mBaseDisplayInfo=(DisplayInfo\{[^\r\n]+\})[ \t]*\r?$/m.exec(fields)?.[1]
  const override = /^[ \t]+mOverrideDisplayInfo=(null|DisplayInfo\{[^\r\n]+\})[ \t]*\r?$/m
    .exec(fields)?.[1]
  // WindowManager overrides geometry, while the base record owns the panel and power state.
  return active && base && override ?
    parsePrimaryDisplayInfo(base, allowDoze, override === 'null' ? base : override) : null
}

function parsePrimaryDisplayInfo(
  info: string, allowDoze: boolean, geometryInfo = info
): DisplayGeometry | null {
  // Android 12L and 13 include an extra quote after the logical display ID.
  const primary = /^DisplayInfo\{.*?, displayId 0"?,/
  const dimensions = /, real (\d+) x (\d+),/.exec(geometryInfo)
  const orientation = /, rotation ([0-3]),/.exec(geometryInfo)
  if (!primary.test(info) || !primary.test(geometryInfo) || !info.includes(', type INTERNAL,') ||
      !dimensions || !orientation) {
    return null
  }
  const state = /, state (\w+),/.exec(info)?.[1]
  const committed = /, committedState (\w+),/.exec(info)?.[1]
  const active = state === 'ON' && (!committed || committed === 'ON' || committed === 'UNKNOWN')
  const dozing = allowDoze && (state === 'DOZE' || state === 'DOZE_SUSPEND') &&
    (committed === state || committed === 'UNKNOWN')
  if (!active && !dozing) {
    return null
  }
  const width = Number(dimensions[1])
  const height = Number(dimensions[2])
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    return null
  }
  const uniqueId = /, uniqueId "([^"]*)"/.exec(info)?.[1]
  const addressText = /, address (\{[^{}]*\})/.exec(info)?.[1]
  const address = addressText ? parsePhysicalAddress(addressText) : null
  const geometry = {
    ...naturalGeometry(primaryDisplayId, width, height, Number(orientation[1]))
  , uniqueId
  , ...(address ? {address} : {})
  }
  return dozing ? {...geometry, doze: {state, committed}} : geometry
}

function sameGeometry(left: DisplayGeometry, right: DisplayGeometry): boolean {
  return left.width === right.width && left.height === right.height &&
    left.rotation === right.rotation && left.uniqueId === right.uniqueId &&
    left.address?.port === right.address?.port && left.address?.model === right.address?.model
}

function panelChanged(prior: DisplayGeometry, current: DisplayGeometry): boolean {
  const before = prior.address
  const after = current.address
  return prior.width !== current.width || prior.height !== current.height ||
    Boolean(prior.uniqueId && current.uniqueId && prior.uniqueId !== current.uniqueId) ||
    Boolean(before && after && (before.port !== after.port ||
      (before.model && after.model && before.model !== after.model)))
}

export class AndroidDisplayRegistry extends EventEmitter.EventEmitter<AndroidDisplayEvents> {
  readonly id = primaryDisplayId
  private geometry: DisplayGeometry
  private active: AndroidDisplayTarget
  private refreshing: Promise<void> | null = null
  private rotationGeneration = 0
  private transitioning = false

  constructor(
    readonly properties: DisplayProperties
  , private readonly readPrimary:
      (signal?: AbortSignal, allowDoze?: boolean) => Promise<DisplayGeometry | null>
  , private readonly readLayout?: (state: number) => Promise<PhysicalDisplayAddress | null>
  ) {
    super()
    const {width, height, rotation} = properties
    this.geometry = {id: primaryDisplayId, width, height, rotation}
    this.active = this.snapshot()
  }

  get target(): AndroidDisplayTarget {
    return this.active
  }

  get isTransitioning(): boolean {
    return this.transitioning
  }

  invalidate(): void {
    this.active = this.snapshot()
    this.emit('change', this.active)
  }

  beginTransition(): void {
    this.transitioning = true
    this.rotationGeneration += 1
    this.emit('transition')
  }

  endTransition(): void {
    this.transitioning = false
  }

  async refreshAfterPosture(
    state: number, allowSamePanelDoze: boolean, stateChanged: boolean
  ): Promise<AndroidDisplayTarget> {
    let expected: PhysicalDisplayAddress | null = null
    if (this.readLayout) {
      expected = await this.readLayout(state).catch((error: unknown) => {
        log.debug('Unable to read the Android device-state display layout: %s', error)
        return null
      })
    }
    return this.refreshAfterTransition((geometry, prior) => {
      if (expected) {
        const {address} = geometry
        return address?.port === expected.port &&
          (!expected.model || address.model === expected.model)
      }
      // Without a layout, an unchanged view cannot confirm a new physical state.
      return !stateChanged || panelChanged(prior, geometry)
    }, allowSamePanelDoze)
  }

  async refreshAfterTransition(
    accepts: (geometry: DisplayGeometry, prior: DisplayGeometry) => boolean = () => true
  , allowSamePanelDoze = false
  ): Promise<AndroidDisplayTarget> {
    await this.refreshing
    const prior = this.geometry
    const deadline = AbortSignal.timeout(displaySettleTimeoutMs)
    let previous: DisplayGeometry | null = null
    try {
      for (;;) {
        deadline.throwIfAborted()
        const sample = await this.readPrimary(deadline, allowSamePanelDoze)
          .catch((error: unknown) => {
            log.debug('Unable to read foldable display during transition: %s', error)
            return null
          })
        deadline.throwIfAborted()
        const samePanel = sample?.uniqueId && sameGeometry(prior, sample)
        const powerReady = !sample?.doze || (allowSamePanelDoze && samePanel)
        const candidate = sample && accepts(sample, prior) && powerReady ? sample : null
        if (candidate && previous && sameGeometry(previous, candidate) &&
          candidate.doze?.state === previous.doze?.state &&
          candidate.doze?.committed === previous.doze?.committed) {
          this.update(candidate)
          return this.active
        }
        previous = candidate
        await delay(displaySampleIntervalMs, null, {signal: deadline})
      }
    }
    catch (error) {
      if (!deadline.aborted) {
        throw error
      }
      throw new Error('The foldable device state changed, but the active display did not settle', {
        cause: error
      })
    }
  }

  refresh(): Promise<void> {
    if (this.transitioning) {
      return Promise.resolve()
    }
    if (!this.refreshing) {
      const generation = this.rotationGeneration
      this.refreshing = Promise.resolve().then(() => this.readPrimary())
        .catch((error: unknown) => {
          log.debug('Unable to refresh the foldable display: %s', error)
          return null
        })
        .then(geometry => {
          // Retain the observed rotation if it changed while the probe was running.
          if (geometry && generation === this.rotationGeneration) {
            this.update(geometry)
          }
        })
        .finally(() => {
          this.refreshing = null
        })
    }
    return this.refreshing
  }

  updateRotation(rotation: number): void {
    if (this.transitioning || rotation === this.properties.rotation) {
      return
    }
    this.rotationGeneration += 1
    this.update({...this.geometry, rotation})
  }

  private update(geometry: DisplayGeometry): void {
    const previous = this.geometry
    const {width, height, rotation} = geometry
    if (sameGeometry(previous, geometry)) {
      return
    }
    this.geometry = geometry
    Object.assign(this.properties, {width, height, rotation})
    if (rotation !== previous.rotation) {
      this.emit('rotationChange', rotation)
    }
    this.invalidate()
  }

  private snapshot(): AndroidDisplayTarget {
    const {id, width, height, rotation} = this.geometry
    return Object.freeze({id, width, height, rotation, revision: randomUUID()})
  }
}

export function normalizeDisplayProperties(properties: DisplayProperties): DisplayProperties {
  var validSize = typeof properties.size === 'number' &&
    Number.isFinite(properties.size) && properties.size > 0
  if (!validSize) {
    var size = computeDisplaySize(
      properties.width
    , properties.height
    , properties.xdpi
    , properties.ydpi
    )
    if (typeof size === 'number') {
      properties.size = size
    }
    else {
      delete properties.size
    }
  }
  if (!Number.isFinite(properties.xdpi) || properties.xdpi < 0) {
    properties.xdpi = 0
  }
  if (!Number.isFinite(properties.ydpi) || properties.ydpi < 0) {
    properties.ydpi = 0
  }
  if (!Number.isFinite(properties.fps) || properties.fps < 0) {
    properties.fps = 0
  }
  if (!Number.isFinite(properties.density) || properties.density < 0) {
    properties.density = 0
  }
  return properties
}

export default syrup.serial()
  .dependency(adbSyrup)
  .dependency(minicapSyrup)
  .dependency(serviceSyrup)
  .dependency(optionsSyrup)
  .define(function(
    options: DevicePluginOptions
  , adb: Adb
  , minicap: MinicapResource
  , service: ServicePlugin
  , screenOptions: ScreenOptions
  ) {
    function infoFromMinicap(id: number): Bluebird<DisplayProperties> {
      return minicap.run(minicap.grabber, `-d ${id} -i`)
        .then(streamutil.readAll)
        .then(out => {
          const output = out.toString()
          try {
            return JSON.parse(output) as DisplayProperties
          }
          catch {
            throw new Error(output)
          }
        })
    }

    async function readDisplayOutput(args: string[], signal: AbortSignal) {
      signal.throwIfAborted()
      const stream = await adb.client.getDevice(options.serial).shell(args, {signal})
      try {
        return (await streamutil.readAll(stream)).toString()
      }
      finally {
        stream.destroy()
      }
    }

    let useDisplayDump = false
    async function readPrimary(deadline?: AbortSignal, allowDoze = false) {
      const timeout = AbortSignal.timeout(displayShellTimeoutMs)
      const signal = deadline ? AbortSignal.any([timeout, deadline]) : timeout
      if (!useDisplayDump) {
        const output = await readDisplayOutput(['cmd', 'display', 'get-displays'], signal)
        if (output.trim() !== 'Unknown command: get-displays') {
          return parsePrimaryDisplay(output, allowDoze)
        }
        useDisplayDump = true
      }
      const output = await readDisplayOutput(['dumpsys', 'display'], signal)
      return parsePrimaryDisplayDump(output, allowDoze)
    }

    async function readLayout(state: number) {
      const dump = await readDisplayOutput(['dumpsys', 'display'],
        AbortSignal.timeout(displayShellTimeoutMs))
      return parsePrimaryDisplayLayout(dump, state)
    }

    log.info('Reading display info')
    return service.getDisplay(primaryDisplayId)
      .catch(() => infoFromMinicap(primaryDisplayId))
      .then(properties => {
        properties.url = screenOptions.publicUrl
        const normalized = normalizeDisplayProperties(properties)
        const display = new AndroidDisplayRegistry(normalized, readPrimary, readLayout)
        service.on('rotationChange', data => display.updateRotation(data.rotation))
        return display
      })
  })
