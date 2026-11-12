import {spawn} from 'node:child_process'
import {randomBytes, randomUUID} from 'node:crypto'
import {once} from 'node:events'
import {dirname, join} from 'node:path'
import {createInterface, type Interface} from 'node:readline'
import type {Writable} from 'node:stream'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'

export class CoreDeviceError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface CoreDeviceScreen {
  sessionId: string
  codec: string
  description: string
  body: ReadableStream<Uint8Array>
}

export class CoreDeviceSession {
  readonly id = randomUUID()
  readonly signal: AbortSignal
  readonly closed: Promise<void>
  private readonly controller = new AbortController()
  private readonly origin: Promise<string>
  private readonly authorization: string
  private readonly input: Writable
  private readonly replies: Interface
  private inputBusy = false
  private keyframeAt = Number.NEGATIVE_INFINITY

  constructor(
    pymobiledevice3: string, udid: string, rsd: [string, string], signal: AbortSignal,
    log: (message: string) => void
  ) {
    this.signal = AbortSignal.any([signal, this.controller.signal])
    const password = randomBytes(24).toString('hex')
    this.authorization = 'Basic ' + Buffer.from('stf:' + password).toString('base64')
    const binary = pymobiledevice3.includes('/') ?
      join(dirname(pymobiledevice3), 'python3') : 'python3'
    const script = fileURLToPath(new URL('./coredevice_worker.py', import.meta.url))
    const child = spawn(binary, [script], {stdio: ['pipe', 'pipe', 'pipe']})
    this.input = child.stdin
    this.replies = createInterface({input: child.stdout})
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    child.stdin.on('error', () => this.controller.abort())
    this.replies.on('error', () => this.controller.abort())
    child.on('error', () => this.controller.abort())
    const closeInput = () => child.stdin.end()
    this.signal.addEventListener('abort', closeInput, {once: true})
    this.closed = new Promise(resolve => child.once('close', code => {
      if (!this.signal.aborted && code !== 0) {
        log('CoreDevice screen worker exited: ' + (stderr.trim() || code))
      }
      this.signal.removeEventListener('abort', closeInput)
      this.controller.abort()
      resolve()
    }))
    const portReady = AbortSignal.any([this.signal, AbortSignal.timeout(35000)])
    // The first line reports the HTTP port. Keep reading this pipe for touch acknowledgments.
    this.origin = once(this.replies, 'line', {signal: portReady}).then(([line]) => {
      const port = Number(line)
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('CoreDevice screen worker returned an invalid port')
      }
      return 'http://127.0.0.1:' + port
    })
    const config = {udid, address: rsd[0], rsdPort: Number(rsd[1]), password}
    child.stdin.write(JSON.stringify(config) + '\n')
    if (this.signal.aborted) {
      closeInput()
    }
  }

  private async request(path: string, signal: AbortSignal): Promise<Response> {
    const origin = await this.origin
    return fetch(origin + path, {
      signal, redirect: 'error', headers: {Authorization: this.authorization}
    })
  }

  async screen(): Promise<CoreDeviceScreen> {
    const startup = AbortSignal.any([this.signal, AbortSignal.timeout(35000)])
    while (!startup.aborted) {
      const response = await this.request('/codec', startup).catch(() => null)
      if (response?.ok) {
        const {codec, description} = await response.json() as {codec: unknown, description: unknown}
        if (typeof codec !== 'string' || !/^(hev1|hvc1)\.[a-z0-9.]{1,127}$/i.test(codec) ||
            typeof description !== 'string' || description.length > 4096 ||
            !/^[a-z0-9+/]+={0,2}$/i.test(description)) {
          throw new Error('CoreDevice returned invalid HEVC configuration')
        }
        const connect = new AbortController()
        const timer = setTimeout(() => connect.abort(), 10000)
        const signal = AbortSignal.any([this.signal, connect.signal])
        const screen = await this.request('/stream.bin', signal)
          .finally(() => clearTimeout(timer))
        const binary = screen.headers.get('content-type') === 'application/octet-stream'
        if (!screen.ok || !screen.body || !binary) {
          await screen.body?.cancel()
          throw new Error('CoreDevice video stream is unavailable')
        }
        return {sessionId: this.id, codec, description, body: screen.body}
      }
      await response?.body?.cancel()
      await delay(100, null, {signal: startup})
    }
    startup.throwIfAborted()
    throw new Error('CoreDevice screen worker did not become ready')
  }

  async touch(type: 'contact' | 'release', position: {x: number, y: number}, signal: AbortSignal) {
    if (this.inputBusy) {
      throw new CoreDeviceError('IOS_COREDEVICE_INPUT_BUSY', 409)
    }
    this.inputBusy = true
    try {
      const active = AbortSignal.any([signal, this.signal, AbortSignal.timeout(1500)])
      active.throwIfAborted()
      await this.origin
      active.throwIfAborted()
      const acknowledged = once(this.replies, 'line', {signal: active})
      const written = new Promise<void>((resolve, reject) => {
        const message = {type, x: Math.round(position.x * 65535), y: Math.round(position.y * 65535)}
        this.input.write(JSON.stringify(message) + '\n', error => error ? reject(error) : resolve())
      })
      const [[reply]] = await Promise.all([acknowledged, written])
      if (reply !== 'ok') {
        throw new Error('CoreDevice input was rejected')
      }
    }
    catch (error) {
      this.controller.abort()
      throw error
    }
    finally {
      this.inputBusy = false
    }
  }

  async keyframe(signal: AbortSignal) {
    const now = performance.now()
    if (now - this.keyframeAt >= 500) {
      this.keyframeAt = now
      const active = AbortSignal.any([signal, this.signal, AbortSignal.timeout(1000)])
      const result = await this.request('/pli', active)
      await result.text()
      if (!result.ok) {
        throw new Error('CoreDevice keyframe request was rejected')
      }
    }
  }

  stop(): void {
    this.controller.abort()
  }
}
