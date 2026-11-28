import type {AndroidDisplayTarget} from '../../../../types/android-display.js'
import {TouchGesture} from '../../../../wire/touch-gesture.js'
import {requiresDisplayInput, type NaturalDisplaySize} from './display-geometry.js'

interface GestureMessage {
  seq: number
  gestureId?: string | null
  reservationId?: string | null
}

interface ContactMessage extends GestureMessage {
  contact: number
}

interface PointMessage extends ContactMessage {
  x: number
  y: number
  pressure?: number | null
}

interface PrimaryInput {
  touchDown(point: PointMessage): void
  touchMove(point: PointMessage): void
  touchUp(point: ContactMessage): void
  touchCommit(): void
  touchReset(): void
  touchFinish(heldContacts: ReadonlySet<number>): void
}

type Point = readonly [number, number]

interface Contact {
  index: number
  start: Point
  end: Point
  startedAt: number
  duration: number | null
  downCommitted: boolean
  upCommitted: boolean
}

function logicalPoint(target: AndroidDisplayTarget, point: PointMessage): Point | null {
  const {x, y} = point
  const {width, height, rotation} = target
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1 ||
      !Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    return null
  }
  const pixel = (fraction: number, extent: number) =>
    Math.min(extent - 1, Math.floor(fraction * extent))
  switch (rotation) {
  case 0: return [pixel(x, width), pixel(y, height)]
  case 90: return [pixel(y, height), pixel(1 - x, width)]
  case 180: return [pixel(1 - x, width), pixel(1 - y, height)]
  case 270: return [pixel(1 - y, height), pixel(x, width)]
  default: return null
  }
}

/** Routes gestures using the primary display geometry they started on. */
export class AndroidDisplayTouch {
  private readonly gestures: TouchGesture
  private active: {target: AndroidDisplayTarget, gestureId: string | null} | null = null
  private contact: Contact | null = null
  private discarded = false
  private inFlight: {gestureId: string, controller: AbortController} | null = null

  constructor(
    private readonly primary: PrimaryInput
  , private readonly initialPrimarySize: NaturalDisplaySize
  , private readonly getTarget: () => AndroidDisplayTarget | null
  , private readonly runInput: (args: string[], signal: AbortSignal) => Promise<string>
  , private readonly report: (error: Error) => void
  , private readonly now = () => performance.now()
  ) {
    this.gestures = new TouchGesture(() => this.abortGesture(), {
      report
      , onFinish: held => this.finish(held)
      , onCancel: matches => {
        if (this.inFlight && matches(this.inFlight.gestureId)) {
          this.inFlight.controller.abort()
        }
      }
    })
  }

  setOwner(reservationId: string | null) {
    this.inFlight?.controller.abort()
    if (!this.useNativeTouch(this.active?.target ?? null)) {
      this.primary.touchReset()
    }
    this.gestures.setOwner(reservationId)
  }

  displayChanged() {
    this.inFlight?.controller.abort()
    this.gestures.clear()
  }

  start(message: GestureMessage & {displayRevision?: string | null}) {
    this.gestures.start(message.seq, message.gestureId, message.reservationId, () => {
      const target = this.getTarget()
      const {displayRevision} = message
      const matches = target?.id === 0 && (typeof displayRevision === 'string' ?
        target.revision === displayRevision : this.useNativeTouch(target))
      this.active = matches ? {target, gestureId: message.gestureId ?? null} : null
      this.contact = null
      this.discarded = false
    })
  }

  stop(message: GestureMessage) {
    this.gestures.stop(message.seq, message.gestureId, message.reservationId)
  }

  down(message: PointMessage) {
    this.enqueue(message, {type: 'down', contact: message.contact}, target => {
      if (this.useNativeTouch(target)) {
        this.primary.touchDown(message)
      }
      else {
        const start = logicalPoint(target, message)
        if (this.contact || !start || !Number.isInteger(message.contact) ||
            message.contact < 0 || message.contact >= 32) {
          this.discarded = true
          return
        }
        this.contact = {index: message.contact, start, end: start, startedAt: this.now()
          , duration: null, downCommitted: false, upCommitted: false}
      }
    })
  }

  move(message: PointMessage) {
    this.enqueue(message, {type: 'move', contact: message.contact}, target => {
      if (this.useNativeTouch(target)) {
        this.primary.touchMove(message)
      }
      else {
        const next = logicalPoint(target, message)
        if (next && this.contact?.index === message.contact && this.contact.duration === null) {
          this.contact.end = next
        }
        else {
          this.discarded = true
        }
      }
    })
  }

  up(message: ContactMessage) {
    this.enqueue(message, {type: 'up', contact: message.contact}, target => {
      if (this.useNativeTouch(target)) {
        this.primary.touchUp(message)
      }
      else if (this.contact?.index === message.contact && this.contact.duration === null &&
          this.contact.downCommitted) {
        this.contact.duration = Math.round(this.now() - this.contact.startedAt)
      }
      else {
        this.discarded = true
      }
    })
  }

  commit(message: GestureMessage) {
    this.enqueue(message, {type: 'commit'}, target => {
      if (this.useNativeTouch(target)) {
        this.primary.touchCommit()
      }
      else if (this.contact) {
        if (this.contact.duration === null) {
          this.contact.downCommitted = true
        }
        else {
          this.contact.upCommitted = true
        }
      }
    })
  }

  reset(message: GestureMessage & {cancel?: boolean | null, cancelThrough?: boolean | null}) {
    if (message.gestureId && message.cancel !== false) {
      this.gestures.clear(message.gestureId, message.reservationId, message.cancelThrough === true)
    }
    else {
      this.enqueue(message, {type: 'reset'}, target => {
        if (this.useNativeTouch(target)) {
          this.primary.touchReset()
        }
        else {
          this.discarded = true
        }
      })
    }
  }

  private enqueue(message: GestureMessage, metadata: Parameters<TouchGesture['push']>[4],
    deliver: (target: AndroidDisplayTarget) => void) {
    this.gestures.push(message.seq, () => {
      const target = this.active?.target
      if (target && target.revision === this.getTarget()?.revision && !this.discarded) {
        deliver(target)
      }
    }, message.gestureId, message.reservationId, metadata)
  }

  private useNativeTouch(target: AndroidDisplayTarget | null): boolean {
    return !!target && !requiresDisplayInput(target, this.initialPrimarySize)
  }

  private abortGesture() {
    if (this.useNativeTouch(this.active?.target ?? null)) {
      this.primary.touchReset()
    }
    this.active = null
    this.contact = null
  }

  private finish(held: ReadonlySet<number>) {
    const {target, gestureId} = this.active ?? {}
    const contact = this.contact
    this.active = null
    this.contact = null
    if (this.useNativeTouch(target ?? null)) {
      this.primary.touchFinish(held)
    }
    else if (target && gestureId && target.revision === this.getTarget()?.revision &&
        !this.discarded && !held.size && contact?.upCommitted && contact.duration !== null &&
        !this.inFlight) {
      this.send(gestureId, contact.start, contact.end, contact.duration)
    }
  }

  private send(gestureId: string, start: Point, end: Point, duration: number) {
    const command = start[0] === end[0] && start[1] === end[1] && duration < 500 ?
      ['tap', ...start] : ['swipe', ...start, ...end, Math.max(1, Math.min(1000, duration))]
    const controller = new AbortController()
    this.inFlight = {gestureId, controller}
    const {signal} = controller
    this.runInput(command.map(String), signal)
      .then(output => {
        if (output.trim()) {
          throw new Error('Foldable input failed: ' + output.trim().slice(0, 200))
        }
      })
      .catch((err: Error) => {
        if (!signal.aborted) {
          this.report(err)
        }
      })
      .finally(() => {
        this.inFlight = null
      })
  }
}
