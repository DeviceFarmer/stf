import type {PrototypeClient} from './client.js'

interface Touch {
  kind: 'down' | 'move' | 'up'
  x: number
  y: number
}

interface Session {
  id: string
  signal: AbortSignal
  pending: Touch[]
  sending: boolean
  fail: (error: unknown) => void
}

export class CoreDeviceInput {
  private session: Session | null = null

  constructor(private readonly client: PrototypeClient) {}

  get active() {
    return this.session && !this.session.signal.aborted ? this.session.id : null
  }

  connect(id: string, signal: AbortSignal, fail: Session['fail']) {
    const session = {id, signal, pending: [], sending: false, fail}
    this.session = session
    return () => {
      if (this.session === session) {
        this.session = null
      }
    }
  }

  send(id: string, kind: Touch['kind'], {x, y}: {x: number, y: number}) {
    const session = this.session
    if (!session || id !== this.active) {
      return
    }
    const pending = session.pending
    const touch = {kind, x, y}
    if (kind === 'move' && pending.at(-1)?.kind === 'move') {
      pending[pending.length - 1] = touch
      return
    }
    if (pending.length >= 32) {
      this.fail(session, new Error('CoreDevice input queue exceeded its limit'))
      return
    }
    pending.push(touch)
    if (!session.sending) {
      this.drain(session)
    }
  }

  private async drain(session: Session) {
    session.sending = true
    try {
      while (this.session === session && !session.signal.aborted && session.pending.length) {
        const {kind, x, y} = session.pending.shift()!
        const response = await this.client.request('/coredevice/touch', {
          sessionId: session.id, type: kind === 'up' ? 'release' : 'contact', x, y
        }, AbortSignal.any([session.signal, AbortSignal.timeout(2000)]))
        await response.arrayBuffer()
      }
    }
    catch (error) {
      this.fail(session, error)
    }
    finally {
      session.sending = false
    }
  }

  private fail(session: Session, error: unknown) {
    if (this.session === session && !session.signal.aborted) {
      this.session = null
      session.fail(error)
    }
  }
}
