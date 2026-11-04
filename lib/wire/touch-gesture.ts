import SeqQueue from './seqqueue.js'

type Operation = () => void

interface TouchMetadata {
  type: 'down' | 'move' | 'up' | 'reset' | 'commit'
  contact?: number
}

interface Packet {
  operation: Operation
  metadata: TouchMetadata | {type: 'stop'} | undefined
}

interface Gesture {
  id: string | null
  queue: SeqQueue
  pending: Map<number, Packet> | null
  buffered: Map<number, Packet>
  timer: ReturnType<typeof setTimeout> | null
  gap: number | null
  next: number | null
  start: number | null
  heldContacts: Set<number>
}

interface Source {
  source: string
  order: number
  issuedAt: number | null
}

interface SourceState {
  order: number
  seen: number
  issuedAt: number | null
}

interface GestureOptions {
  maxPendingGestures?: number
  maxPendingPackets?: number
  maxSources?: number
  maxRetired?: number
  report?: (error: Error) => void
  gapTimeoutMs?: number
  sourceIdleMs?: number
  maxStartAgeMs?: number
  futureClockSkewMs?: number
  onFinish?: (heldContacts: ReadonlySet<number>) => void
}

const cycle = 100
const windowSize = cycle / 2
const legacy = ''

/** Reorders each gesture independently without replaying another reservation's input. */
export class TouchGesture {
  private owner: string | null | undefined
  private current: Gesture | null = null
  private readonly pending = new Map<string, Gesture>()
  private readonly waiting: Gesture[] = []
  private readonly retired = new Set<string>()
  private readonly sources = new Map<string, SourceState>()
  private pendingPackets = 0
  private observedNow = 0
  private readonly maxPendingGestures: number
  private readonly maxPendingPackets: number
  private readonly maxSources: number
  private readonly maxRetired: number
  private readonly sourceIdleMs: number
  private readonly maxStartAgeMs: number
  private readonly futureClockSkewMs: number

  constructor(private readonly reset: () => void, private readonly options: GestureOptions = {}) {
    this.maxPendingGestures = options.maxPendingGestures ?? 8
    this.maxPendingPackets = options.maxPendingPackets ?? 256
    this.maxSources = options.maxSources ?? 128
    this.maxRetired = options.maxRetired ?? 128
    this.sourceIdleMs = options.sourceIdleMs ?? 10000
    this.maxStartAgeMs = options.maxStartAgeMs ?? 10000
    this.futureClockSkewMs = options.futureClockSkewMs ?? 5000
    for (const bound of [this.maxPendingGestures, this.maxPendingPackets
      , this.maxSources, this.maxRetired, options.gapTimeoutMs ?? 2000
      , this.sourceIdleMs, this.maxStartAgeMs, this.futureClockSkewMs]) {
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
    this.waiting.length = 0
    this.pendingPackets = 0
    this.retired.clear()
    this.sources.clear()
    this.owner = reservationId
  }

  private now(): number {
    // A backwards wall-clock adjustment must not make an evicted Start fresh again.
    this.observedNow = Math.max(this.observedNow, Date.now())
    return this.observedNow
  }

  private source(id: string): Source | null {
    const match = /^([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}):([1-9]\d{0,15})(?::(\d{1,16}))?$/i
      .exec(id)
    const order = match ? Number(match[2]) : 0
    const issuedAt = typeof match?.[3] === 'undefined' ? null : Number(match[3])
    return match && Number.isSafeInteger(order) &&
      (issuedAt === null || Number.isSafeInteger(issuedAt)) ?
      {source: match[1]!.toLowerCase(), order, issuedAt} : null
  }

  private allowed(id?: string | null, reservationId?: string | null): boolean {
    if (id !== null && typeof id !== 'undefined' &&
        (typeof id !== 'string' || !id || id.length > 128)) {
      return false
    }
    if (typeof this.owner === 'undefined') {
      return true
    }
    const source = typeof id === 'string' ? this.source(id) : null
    return this.owner !== null && reservationId === this.owner &&
      source !== null && source.issuedAt !== null
  }

  private fresh(id: string | null): boolean {
    const issuedAt = id && this.source(id)?.issuedAt
    if (typeof issuedAt !== 'number') {
      return typeof this.owner === 'undefined'
    }
    const now = this.now()
    return now - issuedAt < this.maxStartAgeMs && issuedAt - now <= this.futureClockSkewMs
  }

  private rememberSource(id: string, advance: boolean): boolean {
    const source = this.source(id)
    if (!source) {
      return typeof this.owner === 'undefined'
    }
    const now = this.now()
    const latest = this.sources.get(source.source)
    if (!latest && this.sources.size >= this.maxSources) {
      const busy = new Set([...this.pending.values(), ...(this.current ? [this.current] : [])]
        .map(entry => entry.id && this.source(entry.id)?.source))
      for (const [key, state] of this.sources) {
        // Keep the watermark until every Start it could reject is already expired.
        if (!busy.has(key) && state.issuedAt !== null && now - state.seen >= this.sourceIdleMs &&
            now - state.issuedAt >= this.maxStartAgeMs) {
          this.sources.delete(key)
          break
        }
      }
      if (this.sources.size >= this.maxSources) {
        this.options.report?.(new Error(
          'Touch source limit reached; retry when idle sources expire'
        ))
        return false
      }
    }
    this.sources.delete(source.source)
    this.sources.set(source.source, {order: advance ? Math.max(latest?.order || 0, source.order) :
      latest?.order || 0, seen: now
      , issuedAt: source.issuedAt === null ? latest?.issuedAt ?? null :
        Math.max(latest?.issuedAt ?? 0, source.issuedAt)})
    return true
  }

  private retire(id: string | null) {
    if (!id) {
      return
    }
    this.rememberSource(id, true)
    this.retired.add(id)
    if (this.retired.size > this.maxRetired) {
      this.retired.delete(this.retired.values().next().value!)
    }
  }

  private forget(entry: Gesture) {
    clearTimeout(entry.timer!)
    entry.timer = null
    entry.queue.stop()
    const waiting = this.waiting.indexOf(entry)
    if (waiting !== -1) {
      this.waiting.splice(waiting, 1)
    }
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
    if (!this.fresh(id)) {
      return null
    }
    if (this.pending.size >= this.maxPendingGestures) {
      this.retire(id)
      this.options.report?.(new Error('Touch gesture buffer is full; retry the gesture'))
      return null
    }
    const entry: Gesture = {id, queue: new SeqQueue(cycle, Infinity)
      , pending: new Map(), buffered: new Map(), timer: null, gap: null, next: null
      , start: null, heldContacts: new Set()}
    this.pending.set(key, entry)
    entry.timer = setTimeout(() => {
      if (this.pending.get(key) === entry) {
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
    const pending = this.pending.get(key || legacy)
    const source = key && this.source(key)
    if ((key && this.retired.has(key)) || this.current?.id === key ||
        (pending && pending.start !== null) || (!pending && !this.fresh(key)) ||
        (source && source.order <= (this.sources.get(source.source)?.order || 0)) ||
        (key && !this.rememberSource(key, false))) {
      return
    }
    const entry = this.entry(key)
    if (!entry) {
      return
    }
    clearTimeout(entry.timer!)
    entry.timer = null
    entry.start = seq
    const currentSource = this.current?.id && this.source(this.current.id)
    const nextSource = key && this.source(key)
    if (this.current && currentSource && nextSource && currentSource.source === nextSource.source) {
      const head = this.waiting[0]
      this.waiting.push(entry)
      this.waiting.sort((left, right) =>
        this.source(left.id!)!.order - this.source(right.id!)!.order)
      if (head && this.waiting[0] !== head) {
        clearTimeout(head.timer!)
        head.timer = null
      }
      this.waitForTail()
      return
    }
    for (const waiting of [...this.waiting]) {
      this.forget(waiting)
    }
    if (this.current) {
      this.reset()
      this.forget(this.current)
      this.current = null
    }
    this.activate(entry)
  }

  private waitForTail() {
    const entry = this.waiting[0]
    if (!entry || entry.timer) {
      return
    }
    entry.timer = setTimeout(() => {
      if (this.waiting[0] === entry && this.current) {
        this.reset()
        this.forget(this.current)
        this.current = null
        this.options.report?.(new Error('Touch gesture tail timed out; continuing the next'))
        this.promote()
      }
    }, this.options.gapTimeoutMs ?? 2000)
    entry.timer.unref?.()
  }

  private promote() {
    if (!this.current && this.waiting.length) {
      this.activate(this.waiting.shift()!)
    }
    this.waitForTail()
  }

  private activate(entry: Gesture) {
    if (entry.id) {
      this.rememberSource(entry.id, true)
    }
    this.current = entry
    clearTimeout(entry.timer!)
    entry.timer = null
    const pending = entry.pending!
    this.pending.delete(entry.id || legacy)
    this.pendingPackets -= pending.size
    entry.pending = null
    const seq = entry.start!
    entry.next = (seq + 1) % cycle
    // Fill the locked queue before Start so arrival order cannot skip the first Down.
    for (const [position, packet] of [...pending].sort(([left], [right]) =>
      (left - seq + cycle) % cycle - (right - seq + cycle) % cycle)) {
      if (position !== seq) {
        this.schedule(entry, position, packet)
      }
    }
    if (this.current === entry) {
      entry.queue.start(seq)
      this.skipGap(entry)
      this.checkGap(entry)
    }
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
        this.promote()
      }
    }, this.options.gapTimeoutMs ?? 2000)
    entry.timer.unref?.()
  }

  private skipGap(entry: Gesture) {
    while (this.current === entry && entry.heldContacts.size > 0 && entry.buffered.size >= 4 &&
        !entry.buffered.has(entry.next!)) {
      const continuations = [...entry.buffered].sort(([left], [right]) =>
        (left - entry.next! + cycle) % cycle - (right - entry.next! + cycle) % cycle)
      let safe = 0
      for (const [, packet] of continuations) {
        const metadata = packet.metadata
        if (!metadata || metadata.type === 'down' || metadata.type === 'reset' ||
            ((metadata.type === 'move' || metadata.type === 'up') &&
              !entry.heldContacts.has(metadata.contact!))) {
          break
        }
        safe++
      }
      if (safe < 4) {
        return
      }
      // Insert a no-op through the queue instead of corrupting its waiting count.
      this.schedule(entry, entry.next!, {operation: () => {}, metadata: {type: 'commit'}}, false)
    }
  }

  private applyMetadata(entry: Gesture, metadata: Packet['metadata']) {
    if (metadata?.type === 'reset') {
      entry.heldContacts.clear()
    }
    else if ((metadata?.type === 'down' || metadata?.type === 'up') &&
        Number.isInteger(metadata.contact) && metadata.contact! >= 0 && metadata.contact! < 32) {
      if (metadata.type === 'down') {
        entry.heldContacts.add(metadata.contact!)
      }
      else {
        entry.heldContacts.delete(metadata.contact!)
      }
    }
  }

  private schedule(entry: Gesture, seq: number, packet: Packet, skip = true) {
    // Half-ring serial arithmetic distinguishes a consumed duplicate from a near-future packet.
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
      this.promote()
      return
    }
    entry.buffered.set(seq, packet)
    entry.queue.push(seq, () => {
      entry.buffered.delete(seq)
      entry.next = (seq + 1) % cycle
      if (this.current === entry) {
        packet.operation()
        this.applyMetadata(entry, packet.metadata)
      }
    })
    if (skip) {
      this.skipGap(entry)
    }
    this.checkGap(entry)
  }

  push(seq: number, operation: Operation, id?: string | null, reservationId?: string | null,
    metadata?: TouchMetadata) {
    this.pushPacket(seq, {operation, metadata}, id, reservationId)
  }

  private pushPacket(seq: number, packet: Packet, id?: string | null,
    reservationId?: string | null) {
    if (!Number.isInteger(seq) || seq < 0 || seq >= cycle || !this.allowed(id, reservationId)) {
      return
    }
    const key = id || (typeof this.owner === 'undefined' ? this.current?.id : null) || null
    if (key && this.retired.has(key)) {
      return
    }
    const order = key && this.source(key)
    if (this.current?.id !== key && !this.pending.has(key || legacy) && order &&
        order.order <= (this.sources.get(order.source)?.order || 0)) {
      return
    }
    const entry = this.entry(key)
    if (!entry) {
      return
    }
    if (entry.pending) {
      if (entry.pending.has(seq)) {
        return
      }
      if (this.pendingPackets >= this.maxPendingPackets || entry.pending.size >= windowSize - 1) {
        this.forget(entry)
        this.options.report?.(new Error('Touch gesture buffer is full; retry the gesture'))
        this.waitForTail()
        return
      }
      entry.pending.set(seq, packet)
      this.pendingPackets++
    }
    else {
      this.schedule(entry, seq, packet)
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
    this.pushPacket(seq, {operation: () => {
      const entry = this.current!
      this.current = null
      this.forget(entry)
      if (this.options.onFinish) {
        this.options.onFinish(new Set(entry.heldContacts))
      }
      else {
        this.reset()
      }
      this.promote()
    }, metadata: {type: 'stop'}}, id, reservationId)
  }

  clear(id?: string | null, reservationId?: string | null, through = false) {
    if (id) {
      const source = through ? this.source(id) : null
      const matches = (entry: Gesture) => {
        if (!through) {
          return entry.id === id
        }
        const identity = entry.id && this.source(entry.id)
        return source && identity && identity.source === source.source &&
          identity.order <= source.order
      }
      const accepted = [...this.pending.values(), ...(this.current ? [this.current] : [])]
        .some(matches)
      if (!this.allowed(id, reservationId) || (through && !source) ||
          (!accepted && !this.fresh(id)) || !this.rememberSource(id, true)) {
        return
      }
      // Remove the whole cancelled range before releasing the head: promoting it
      // first could execute another cancelled gesture's already buffered tail.
      for (const pending of [...this.pending.values()]) {
        if (matches(pending)) {
          this.forget(pending)
        }
      }
      if (this.current && matches(this.current)) {
        this.reset()
        const current = this.current
        this.current = null
        this.forget(current)
      }
      this.retire(id)
      this.promote()
      return
    }
    for (const entry of [...this.pending.values()]) {
      this.forget(entry)
    }
    if (this.current) {
      this.reset()
      const current = this.current
      this.current = null
      this.forget(current)
    }
  }
}
