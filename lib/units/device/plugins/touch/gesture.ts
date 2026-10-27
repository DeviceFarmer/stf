import SeqQueue from '../../../../wire/seqqueue.js'

/** A reset from an old socket must never cancel a newer gesture. */
export class TouchGesture {
  private queue = new SeqQueue(100, 4)
  private id: string | null = null
  private active = false

  constructor(private readonly reset: () => void) {}

  start(seq: number, id?: string | null) {
    if (this.active) {
      this.clear()
    }
    this.queue = new SeqQueue(100, 4)
    this.id = id || null
    this.active = true
    this.queue.start(seq)
  }

  push(seq: number, operation: () => void) {
    if (this.active) {
      this.queue.push(seq, operation)
    }
  }

  stop(seq: number) {
    if (this.active) {
      this.queue.push(seq, () => {
        this.queue.stop()
        this.id = null
        this.active = false
      })
    }
  }

  clear(id?: string | null) {
    if (id && id !== this.id) {
      return
    }
    this.queue = new SeqQueue(100, 4)
    this.id = null
    this.active = false
    this.reset()
  }
}
