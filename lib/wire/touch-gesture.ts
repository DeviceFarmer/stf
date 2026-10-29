import SeqQueue from './seqqueue.js'

type Operation = () => void

interface Gesture {
  id: string | null
  queue: SeqQueue
  pending: Map<number, Operation> | null
  buffered: Set<number>
  timer: ReturnType<typeof setTimeout> | null
  gap: number | null
  next: number | null
}

interface GestureOptions {
  maxPendingGestures?: number
  maxPendingPackets?: number
  maxSources?: number
  maxRetired?: number
  report?: (error: Error) => void
  gapTimeoutMs?: number
}

const cycle = 100
const windowSize = cycle / 2
const legacy = ''

/** Reorders each gesture independently without replaying another reservation's input. */
export class TouchGesture {
  private owner: string | null | undefined
  private current: Gesture | null = null
  private readonly pending = new Map<string, Gesture>()
  private readonly retired = new Set<string>()
  private readonly sources = new Map<string, number>()
  private pendingPackets = 0
  private readonly maxPendingGestures: number
  private readonly maxPendingPackets: number
  private readonly maxSources: number
  private readonly maxRetired: number

  constructor(private readonly reset: () => void, private readonly options: GestureOptions = {}) {
    this.maxPendingGestures = options.maxPendingGestures ?? 8
    this.maxPendingPackets = options.maxPendingPackets ?? 256
    this.maxSources = options.maxSources ?? 128
    this.maxRetired = options.maxRetired ?? 128
    for (const bound of [this.maxPendingGestures, this.maxPendingPackets
      , this.maxSources, this.maxRetired, options.gapTimeoutMs ?? 2000]) {
      if (!Number.isSafeInteger(bound) || bound < 1) {
        throw new Error('Invalid touch gesture limit')
      }
    }
  }

  setOwner(reservationId: string | null) {
    this.reset()
    if (this.current) {
      clearTimeout(this.current.timer!)
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer!)
    }
    this.current = null
    this.pending.clear()
    this.pendingPackets = 0
    this.retired.clear()
    this.sources.clear()
    this.owner = reservationId
  }

  private source(id: string): {source: string, order: number} | null {
    const match = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}):([1-9][0-9]{0,15})$/i
      .exec(id)
    const order = match ? Number(match[2]) : 0
    return match && Number.isSafeInteger(order) ? {source: match[1]!.toLowerCase(), order} : null
  }

  private allowed(id?: string | null, reservationId?: string | null): boolean {
    if (id !== null && typeof id !== 'undefined' &&
        (typeof id !== 'string' || !id || id.length > 128)) {
      return false
    }
    if (typeof this.owner === 'undefined') {
      return true
    }
    return this.owner !== null && reservationId === this.owner &&
      typeof id === 'string' && this.source(id) !== null
  }

  private rememberOrder(id: string, start: boolean): boolean {
    const source = this.source(id)
    if (!source) {
      return typeof this.owner === 'undefined'
    }
    const latest = this.sources.get(source.source)
    if (start && typeof latest !== 'undefined' && source.order <= latest) {
      return false
    }
    if (typeof latest === 'undefined' && this.sources.size >= this.maxSources) {
      this.options.report?.(new Error(
        'Touch source limit reached; release and reacquire the device to continue'
      ))
      return false
    }
    this.sources.set(source.source, Math.max(latest || 0, source.order))
    return true
  }

  private retire(id: string | null) {
    if (!id) {
      return
    }
    this.retired.add(id)
    if (this.retired.size > this.maxRetired) {
      this.retired.delete(this.retired.values().next().value!)
    }
  }

  private forget(entry: Gesture) {
    clearTimeout(entry.timer!)
    entry.timer = null
    if (entry.pending) {
      this.pendingPackets -= entry.pending.size
      this.pending.delete(entry.id || legacy)
      entry.pending = null
    }
    this.retire(entry.id)
  }

  private entry(id: string | null): Gesture | null {
    if (this.current?.id === id) {
      return this.current
    }
    const key = id || legacy
    const found = this.pending.get(key)
    if (found) {
      return found
    }
    if (this.pending.size >= this.maxPendingGestures) {
      if (id) {
        this.rememberOrder(id, false)
      }
      this.retire(id)
      this.options.report?.(new Error('Touch gesture buffer is full; retry the gesture'))
      return null
    }
    const entry: Gesture = {id, queue: new SeqQueue(cycle, Infinity)
      , pending: new Map<number, Operation>(), buffered: new Set()
      , timer: null, gap: null, next: null}
    this.pending.set(key, entry)
    entry.timer = setTimeout(() => {
      if (this.pending.get(key) === entry) {
        if (id) {
          this.rememberOrder(id, false)
        }
        this.forget(entry)
        this.options.report?.(new Error('Touch gesture did not start; retry the gesture'))
      }
    }, this.options.gapTimeoutMs ?? 2000)
    entry.timer.unref?.()
    return entry
  }

  start(seq: number, id?: string | null, reservationId?: string | null) {
    if (!Number.isInteger(seq) || seq < 0 || seq >= cycle || !this.allowed(id, reservationId)) {
      return
    }
    const key = id || null
    if (!key && this.current?.id === null) {
      this.clear()
    }
    if ((key && this.retired.has(key)) || this.current?.id === key ||
        (key && !this.rememberOrder(key, true))) {
      return
    }
    const entry = this.entry(key)
    if (!entry) {
      return
    }
    if (this.current) {
      this.reset()
      this.forget(this.current)
    }
    this.current = entry
    clearTimeout(entry.timer!)
    entry.timer = null
    const pending = entry.pending!
    this.pending.delete(key || legacy)
    this.pendingPackets -= pending.size
    entry.pending = null
    entry.next = (seq + 1) % cycle
    // Fill the locked sequence queue before starting it: a late Start can arrive
    // behind the whole prefix, whose arrival order must not make SeqQueue skip Down.
    for (const [position, operation] of [...pending].sort(([left], [right]) =>
      (left - seq + cycle) % cycle - (right - seq + cycle) % cycle)) {
      if (position !== seq) {
        this.schedule(entry, position, operation)
      }
    }
    entry.queue.start(seq)
    this.checkGap(entry)
  }

  private checkGap(entry: Gesture) {
    const gap = entry.next!
    if (this.current === entry && entry.buffered.size && entry.timer && entry.gap === gap) {
      return
    }
    clearTimeout(entry.timer!)
    entry.timer = null
    entry.gap = null
    if (this.current !== entry || !entry.buffered.size) {
      return
    }
    entry.gap = gap
    entry.timer = setTimeout(() => {
      if (this.current === entry) {
        this.reset()
        this.current = null
        this.forget(entry)
        this.options.report?.(new Error('Touch sequence timed out; retry the gesture'))
      }
    }, this.options.gapTimeoutMs ?? 2000)
    entry.timer.unref?.()
  }

  private schedule(entry: Gesture, seq: number, operation: () => void) {
    // Half-ring serial arithmetic distinguishes a consumed duplicate from a
    // near-future packet, including 0/1 arriving before 99 at the wrap boundary.
    if ((seq - entry.next! + cycle) % cycle >= windowSize || entry.buffered.has(seq)) {
      return
    }
    if (entry.buffered.size >= windowSize - 1 && seq !== entry.next) {
      if (this.current === entry) {
        this.reset()
        this.current = null
      }
      this.forget(entry)
      this.options.report?.(new Error('Touch sequence buffer is full; retry the gesture'))
      return
    }
    entry.buffered.add(seq)
    entry.queue.push(seq, () => {
      entry.buffered.delete(seq)
      entry.next = (seq + 1) % cycle
      operation()
    })
    this.checkGap(entry)
  }

  push(seq: number, operation: () => void, id?: string | null, reservationId?: string | null) {
    if (!Number.isInteger(seq) || seq < 0 || seq >= cycle || !this.allowed(id, reservationId)) {
      return
    }
    const key = id || (typeof this.owner === 'undefined' ? this.current?.id : null) || null
    if (key && this.retired.has(key)) {
      return
    }
    const order = key && this.source(key)
    if (this.current?.id !== key && order &&
        order.order <= (this.sources.get(order.source) || 0)) {
      return
    }
    const entry = this.entry(key)
    if (!entry) {
      return
    }
    const apply = () => {
      if (this.current === entry) {
        operation()
      }
    }
    if (entry.pending) {
      if (entry.pending.has(seq)) {
        return
      }
      if (this.pendingPackets >= this.maxPendingPackets || entry.pending.size >= windowSize - 1) {
        if (key) {
          this.rememberOrder(key, false)
        }
        this.forget(entry)
        this.options.report?.(new Error('Touch gesture buffer is full; retry the gesture'))
        return
      }
      entry.pending.set(seq, apply)
      this.pendingPackets++
    }
    else {
      this.schedule(entry, seq, apply)
    }
  }

  stop(seq: number, id?: string | null, reservationId?: string | null) {
    const key = id || (typeof this.owner === 'undefined' ? this.current?.id : null) || null
    if (!Number.isInteger(seq) || seq < 0 || seq >= cycle || !this.allowed(id, reservationId)) {
      return
    }
    if (this.current?.id === key &&
        (seq - this.current.next! + cycle) % cycle >= windowSize) {
      this.clear(key, reservationId)
      this.options.report?.(new Error('Touch termination exceeded the reorder window; retry'))
      return
    }
    this.push(seq, () => {
      const entry = this.current!
      entry.queue.stop()
      clearTimeout(entry.timer!)
      entry.timer = null
      this.reset()
      this.current = null
      this.retire(key)
    }, id, reservationId)
  }

  clear(id?: string | null, reservationId?: string | null) {
    if (id) {
      if (!this.allowed(id, reservationId) || !this.rememberOrder(id, false)) {
        return
      }
      const pending = this.pending.get(id)
      if (pending) {
        this.forget(pending)
      }
      if (this.current?.id === id) {
        clearTimeout(this.current.timer!)
        this.reset()
        this.current = null
      }
      this.retire(id)
      return
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer!)
      entry.timer = null
      if (entry.id) {
        this.rememberOrder(entry.id, false)
      }
      this.retire(entry.id)
    }
    this.pending.clear()
    this.pendingPackets = 0
    if (this.current) {
      clearTimeout(this.current.timer!)
      this.reset()
      this.retire(this.current.id)
      this.current = null
    }
  }
}
