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

type DozeState = 'DOZE' | 'DOZE_SUSPEND'

interface DisplayGeometry extends Omit<AndroidDisplayTarget, 'revision'> {
  readonly uniqueId?: string | undefined
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

export function parsePrimaryDisplay(output: string, allowDoze = false): DisplayGeometry | null {
  const line = output.split('\n').find(row =>
    /^\s*Display id 0: DisplayInfo\{.*?, displayId 0,/.test(row) &&
    row.includes(', type INTERNAL,') && row.trimEnd().endsWith('isValid=true'))
  const dimensions = line && /, real (\d+) x (\d+),/.exec(line)
  const orientation = line && /, rotation ([0-3]),/.exec(line)
  if (!line || !dimensions || !orientation) {
    return null
  }
  const state = /, state (\w+),/.exec(line)?.[1]
  const committed = /, committedState (\w+),/.exec(line)?.[1]
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
  const uniqueId = /, uniqueId "([^"]*)"/.exec(line)?.[1]
  const geometry = {
    ...naturalGeometry(primaryDisplayId, width, height, Number(orientation[1]))
  , uniqueId
  }
  return dozing ? {...geometry, doze: {state, committed}} : geometry
}

function sameGeometry(left: DisplayGeometry, right: DisplayGeometry): boolean {
  return left.width === right.width && left.height === right.height &&
    left.rotation === right.rotation && left.uniqueId === right.uniqueId
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

  async refreshAfterTransition(
    accepts: (geometry: DisplayGeometry) => boolean = () => true
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
            log.debug('Unable to read Fold4 display during transition: %s', error)
            return null
          })
        deadline.throwIfAborted()
        const samePanel = sample?.uniqueId && sameGeometry(prior, sample)
        const powerReady = !sample?.doze || (allowSamePanelDoze && samePanel)
        const candidate = sample && accepts(sample) && powerReady ? sample : null
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
      throw new Error('Fold4 posture changed, but the active display did not settle', {
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
          log.debug('Unable to refresh the Fold4 display: %s', error)
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

    async function readPrimary(deadline?: AbortSignal, allowDoze = false) {
      const timeout = AbortSignal.timeout(2000)
      const signal = deadline ? AbortSignal.any([timeout, deadline]) : timeout
      const stream = await adb.client.getDevice(options.serial)
        .shell(['cmd', 'display', 'get-displays'], {signal})
      try {
        return parsePrimaryDisplay((await streamutil.readAll(stream)).toString(), allowDoze)
      }
      finally {
        stream.destroy()
      }
    }

    log.info('Reading display info')
    return service.getDisplay(primaryDisplayId)
      .catch(() => infoFromMinicap(primaryDisplayId))
      .then(properties => {
        properties.url = screenOptions.publicUrl
        const normalized = normalizeDisplayProperties(properties)
        const display = new AndroidDisplayRegistry(normalized, readPrimary)
        service.on('rotationChange', data => display.updateRotation(data.rotation))
        return display
      })
  })
