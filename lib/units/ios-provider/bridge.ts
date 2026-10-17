import wire from '../../wire/index.js'
import wireutil from '../../wire/util.js'
import wirerouter from '../../wire/router.js'
import grouputil from '../../util/grouputil.js'
import {randomUUID} from 'node:crypto'
import type {IosDeviceState, PrototypeClient} from './client.js'
import type {IosOwner} from './access.js'
import {findCatalogDevice} from '../../util/device-catalog.js'

export interface BridgeOptions {
  serial: string
  name: string
  marketName: string
  screenUrl: string
  storageUrl: string
  groupTimeout: number
}

interface Point {x: number, y: number}

export class IosBridge {
  readonly channel: string
  readonly solo = wireutil.makePrivateChannel()
  owner: IosOwner | null = null
  private state: IosDeviceState | null = null
  private identity: InstanceType<typeof wire.DeviceIdentityMessage> | null = null
  private registered = false
  private epoch = 0
  private activity = 0
  private timeout: number
  private queue = Promise.resolve()
  private touch: {from: Point, to: Point, started: number} | null = null
  private multitouch = false
  private lease = randomUUID()
  private installId: string | null = null
  private lastObservation: IosDeviceState | null = null
  private lastHealth = ''
  private actionAbort: AbortController | null = null
  private readonly route: ReturnType<ReturnType<typeof wirerouter>['handler']>

  constructor(
    readonly options: BridgeOptions
  , readonly client: PrototypeClient
  , private readonly send: (channel: string, data: Buffer) => void
  , private readonly disconnect: () => void
  , private readonly report: (error: unknown) => void
  ) {
    this.channel = 'ios:' + options.serial
    this.timeout = options.groupTimeout
    const router = wirerouter()
      .on(wire.DeviceRegisteredMessage, (_channel, message) => {
        if (message.serial === options.serial && this.identity && !this.registered) {
          this.registered = true
          this.broadcast(new wire.DeviceReadyMessage(options.serial, this.channel))
        }
      })
      .on(wire.ProbeMessage, () => {
        if (this.identity && this.registered) {
          this.broadcast(this.identity)
        }
      })
      .on(wire.GroupMessage, (channel, message) => {
        this.transaction(String(channel), async() => {
          if (!this.registered) {
            throw new Error('Device not ready')
          }
          await grouputil.match({serial: options.serial}, message.requirements)
          this.join(message.owner, message.timeout)
        })
      })
      .on(wire.AutoGroupMessage, (_channel, message) => {
        if (this.registered && !this.owner) {
          this.join(message.owner)
        }
      })
      .on(wire.UngroupMessage, (channel, message) => {
        this.transaction(String(channel), async() => {
          await grouputil.match({serial: options.serial}, message.requirements)
          this.leave('ungroup_request')
        })
      })
      .on(wire.TouchDownMessage, (_channel, message) => {
        if (message.contact !== 0 || this.touch) {
          this.multitouch = true
          this.touch = null
        }
        else if (!this.multitouch && this.point(message)) {
          this.touch = {from: message, to: message, started: Date.now()}
        }
      })
      .on(wire.TouchMoveMessage, (_channel, message) => {
        if (this.touch && message.contact === 0 && this.point(message)) {
          this.touch.to = message
        }
      })
      .on(wire.TouchUpMessage, (_channel, message) => {
        const touch = this.touch
        this.touch = null
        if (touch && message.contact === 0 && !this.multitouch) {
          const distance = Math.hypot(touch.to.x - touch.from.x, touch.to.y - touch.from.y)
          if (distance < 0.005) {
            this.command('/tap', touch.to)
          }
          else {
            this.command('/swipe', {
              from: touch.from, to: touch.to
            , durationMs: Math.max(50, Math.min(5000, Date.now() - touch.started))
            })
          }
        }
      })
      .on(wire.GestureStartMessage, () => this.resetTouch())
      .on(wire.TouchResetMessage, () => this.resetTouch())
      .on(wire.TouchCommitMessage, () => null)
      .on(wire.GestureStopMessage, () => this.resetTouch())
      .on(wire.TypeMessage, (_channel, message) => this.command('/text', {text: message.text}))
      .on(wire.PasteMessage, (channel, message) => {
        this.command('/text', {text: message.text}, String(channel))
      })
      .on(wire.KeyDownMessage, () => null)
      .on(wire.KeyUpMessage, (_channel, message) => this.key(message.key))
      .on(wire.KeyPressMessage, (_channel, message) => this.key(message.key))
      .on(wire.InstallMessage, (channel, message) => {
        const epoch = this.epoch
        const lease = this.lease
        this.transaction(String(channel), () => this.enqueue(epoch, async() => {
          const artifact = /^\/s\/blob\/([a-f0-9-]{36})\/([a-f0-9]{32})$/i.exec(message.href)
          if (!artifact || !message.requestId || !this.state?.instance) {
            throw new Error('IOS_INSTALL_INVALID_REQUEST')
          }
          const job = await (await this.client.request('/installations/start', {
            id: message.requestId, lease, artifact: {id: artifact[1], name: artifact[2]}
          , launch: message.launch, instance: this.state.instance, generation: this.state.generation
          })).json() as {id: string, settled: boolean}
          if (epoch !== this.epoch || lease !== this.lease || !this.owner) {
            await this.client.request('/installations/cancel', {id: job.id, lease})
            throw new Error('IOS_INSTALL_INTERRUPTED')
          }
          this.installId = job.settled ? null : job.id
          return job
        }))
      })
      .on(wire.IosShakeMessage, channel => {
        const epoch = this.epoch
        this.transaction(String(channel), () => this.enqueue(epoch, async() => {
          const abort = new AbortController()
          this.actionAbort = abort
          try {
            await this.client.request('/shake', {},
              AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]))
          }
          finally {
            this.actionAbort = null
          }
        }))
      })
      .on(wire.IosUnlockMessage, channel => {
        this.transaction(String(channel), () => this.enqueue(this.epoch, async() =>
          (await this.client.request('/unlock', {})).json(), true))
      })
      .on(wire.IosLockMessage, channel => {
        this.transaction(String(channel), () => this.enqueue(this.epoch, async() => {
          const abort = new AbortController()
          this.actionAbort = abort
          try {
            return await (await this.client.request('/lock', {},
              AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]))).json()
          }
          finally {
            this.actionAbort = null
          }
        }, true))
      })
      .on(wire.IosPowerMessage, (channel, message) => {
        this.transaction(String(channel), () => this.enqueue(this.epoch, async() => {
          if (!['reboot', 'shutdown'].includes(message.action)) {
            throw new Error('IOS_POWER_INVALID_ACTION')
          }
          return (await this.client.request('/power', {action: message.action},
            AbortSignal.timeout(20000))).json()
        }, true))
      })
      .on(wire.IosInstallStatusMessage, (channel, message) => {
        this.installationCommand(String(channel), '/installations/status', message.id || undefined)
      })
      .on(wire.IosInstallCancelMessage, (channel, message) => {
        this.installationCommand(String(channel), '/installations/cancel', message.id)
      })
      .on(wire.ScreenCaptureMessage, channel => {
        const epoch = this.epoch
        this.transaction(String(channel), () => this.enqueue(epoch, async() => {
          const image = await this.client.request('/screenshot')
          const bytes = await image.arrayBuffer()
          const form = new FormData()
          form.append('file', new Blob([bytes], {
            type: image.headers.get('content-type') || 'image/png'
          }), 'ios-screenshot.png')
          const response = await fetch(new URL('/s/upload/image', options.storageUrl), {
            method: 'POST', body: form, signal: AbortSignal.timeout(15000), redirect: 'error'
          })
          if (response.status !== 201) {
            await response.body?.cancel()
            throw new Error('Screenshot storage unavailable')
          }
          const body = await response.json() as {resources: {file: unknown}}
          return body.resources.file
        }, true))
      })
    this.route = router.handler()
  }

  private point(point: Point) {
    return [point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
  }

  private installationCommand(channel: string, path: string, id?: string) {
    const epoch = this.epoch
    const lease = this.lease
    this.transaction(channel, () => this.enqueue(epoch, async() => {
      const job = await (await this.client.request(path, {lease, ...(id ? {id} : {})})).json() as
        {id: string, settled: boolean} | null
      if (epoch !== this.epoch || lease !== this.lease) {
        throw new Error('IOS_INSTALL_INTERRUPTED')
      }
      this.installId = job && !job.settled ? job.id : null
      return job
    }))
  }

  private resetTouch() {
    this.touch = null
    this.multitouch = false
  }

  private key(key: string) {
    if (key === 'home') {
      this.command('/home', {})
    }
    else if (key === 'del' || key === 'enter') {
      this.command('/text', {text: key === 'del' ? '\b' : '\n'})
    }
  }

  private command(path: string, body: unknown, replyChannel?: string) {
    const operation = () => this.enqueue(this.epoch, async() => {
      await this.client.request(path, body)
    }, ['/tap', '/swipe', '/home', '/text'].includes(path))
    if (replyChannel) {
      this.transaction(replyChannel, operation)
    }
    else {
      operation().catch(this.report)
    }
  }

  private enqueue<T>(epoch: number, operation: () => Promise<T>, allowLocked = false): Promise<T> {
    const result = this.queue.then(async() => {
      if (!this.owner || epoch !== this.epoch) {
        throw new Error('Device session ended')
      }
      const current = await this.client.device()
      if (current.udid !== this.options.serial || current.state !== 'ready' ||
          (!allowLocked && current.ios?.locked) ||
          current.generation !== this.state?.generation || epoch !== this.epoch || !this.owner) {
        throw new Error('Device session changed')
      }
      if (current.instance !== this.state?.instance) {
        throw new Error('Device session changed')
      }
      return operation()
    })
    this.queue = result.then(() => {}, () => {})
    return result
  }

  private transaction(channel: string, operation: () => Promise<unknown>) {
    const reply = wireutil.reply(this.options.serial)
    operation().then(
      body => this.send(channel, reply.okay('success', body))
    , error => this.send(channel, reply.fail((error as Error).message))
    )
  }

  private join(owner: IosOwner, timeout?: number | null) {
    if (this.owner && this.owner.email !== owner.email) {
      throw new Error('Device already owned')
    }
    if (!this.owner) {
      this.owner = owner
      this.lease = randomUUID()
      this.epoch++
      // GroupMessage/API timeouts are milliseconds; the CLI fallback is seconds.
      this.timeout = Math.min(3600, Math.max(10,
        timeout ? timeout / 1000 : this.options.groupTimeout))
      this.broadcast(new wire.JoinGroupMessage(this.options.serial, owner))
    }
    this.keepalive()
  }

  leave(reason: string) {
    this.actionAbort?.abort()
    const owner = this.owner
    const id = this.installId
    const lease = this.lease
    this.installId = null
    if (id) {
      this.client.request('/installations/cancel', {id, lease}).catch(this.report)
    }
    this.owner = null
    this.epoch++
    this.resetTouch()
    this.disconnect()
    if (owner) {
      this.broadcast(new wire.LeaveGroupMessage(this.options.serial, owner, reason))
    }
  }

  keepalive() {
    this.activity = Date.now()
  }

  private broadcast(message: wireutil.Message) {
    this.send(wireutil.global, wireutil.envelope(message))
  }

  handle(channel: string, data: Buffer) {
    // ZeroMQ subscriptions are prefixes. Never accept an extended or user-group topic.
    if (channel !== this.channel && channel !== this.solo) {
      return
    }
    const envelope = wire.Envelope.decode(data)
    // The provider channel is public metadata; it only accepts registration acknowledgements.
    if (channel === this.solo && envelope.type !== wire.DeviceRegisteredMessage.$code) {
      return
    }
    const setup = [wire.ProbeMessage.$code, wire.DeviceRegisteredMessage.$code
      , wire.GroupMessage.$code, wire.AutoGroupMessage.$code]
    if (!setup.includes(envelope.type) && (!this.owner || !this.registered)) {
      return
    }
    const supported = [
      ...setup, wire.UngroupMessage.$code, wire.TouchDownMessage.$code, wire.TouchMoveMessage.$code
    , wire.TouchUpMessage.$code, wire.TouchCommitMessage.$code, wire.TouchResetMessage.$code
    , wire.GestureStartMessage.$code, wire.GestureStopMessage.$code, wire.KeyDownMessage.$code
    , wire.KeyUpMessage.$code, wire.KeyPressMessage.$code, wire.TypeMessage.$code
    , wire.PasteMessage.$code, wire.ScreenCaptureMessage.$code
    , wire.InstallMessage.$code, wire.IosInstallStatusMessage.$code
    , wire.IosInstallCancelMessage.$code
    , wire.IosShakeMessage.$code
    , wire.IosUnlockMessage.$code, wire.IosLockMessage.$code, wire.IosPowerMessage.$code
    ]
    if (!supported.includes(envelope.type)) {
      if (envelope.channel) {
        this.send(envelope.channel, wireutil.reply(this.options.serial).fail('Unsupported on iOS'))
      }
      return
    }
    this.keepalive()
    this.route(channel, data)
  }

  async poll() {
    try {
      const state = await this.client.device()
      if (state.udid !== this.options.serial) {
        throw new Error('iOS backend selected a different phone')
      }
      this.lastObservation = state
      if (state.state !== 'ready') {
        this.absent()
        this.publishHealth(state)
        return
      }
      if (this.state?.generation !== state.generation || this.state?.instance !== state.instance) {
        this.absent()
      }
      if (!this.identity) {
        const image = Buffer.from(await (await this.client.request('/screenshot')).arrayBuffer())
        if (image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
          throw new Error('Configure PNG screenshots in WDA to identify the display')
        }
        const info = state.info || {}
        const model = info.ProductType || 'iPhone'
        const catalog = findCatalogDevice({platform: 'ios', manufacturer: 'Apple', model})
        this.identity = new wire.DeviceIdentityMessage({
          serial: this.options.serial, platform: 'iOS', manufacturer: 'Apple'
        , model, version: info.ProductVersion || 'unknown'
        , abi: 'arm64', sdk: info.ProductVersion || 'unknown'
        , marketName: this.options.marketName || catalog?.name || model
        , display: new wire.DeviceDisplayMessage({
            id: 0, width: image.readUInt32BE(16), height: image.readUInt32BE(20), rotation: 0
          , xdpi: 0, ydpi: 0, fps: 10, density: 1, secure: true, url: this.options.screenUrl
          })
        , phone: new wire.DevicePhoneMessage({})
        })
        this.state = state
      }
      if (!this.registered) {
        this.broadcast(new wire.DeviceIntroductionMessage(
          this.options.serial, wire.DeviceStatus.ONLINE
        , new wire.ProviderMessage(this.solo, this.options.name), Date.now()
        ))
      }
      else {
        this.broadcast(new wire.DeviceHeartbeatMessage(this.options.serial))
      }
      this.publishHealth(state)
      if (this.owner && Date.now() - this.activity > this.timeout * 1000) {
        this.leave('automatic_timeout')
      }
      if (this.owner && this.installId) {
        const epoch = this.epoch
        const job = await (await this.client.request('/installations/keepalive', {
          lease: this.lease, id: this.installId
        })).json() as {settled: boolean}
        if (epoch === this.epoch && job.settled) {
          this.installId = null
        }
      }
    }
    catch (error) {
      this.absent()
      if (this.lastObservation?.ios) {
        this.publishHealth({...this.lastObservation, ios: {...this.lastObservation.ios
          , reason: 'provider_unavailable', updatedAt: new Date().toISOString()}})
      }
      this.report(error)
    }
  }

  private publishHealth(state: IosDeviceState) {
    if (!state.ios) {
      return
    }
    const value = JSON.stringify(state.ios)
    if (value !== this.lastHealth) {
      this.broadcast(new wire.DevicePropertiesMessage(this.options.serial, [
        new wire.DeviceProperty('stf.ios.status', value)
      ]))
      this.lastHealth = value
    }
  }

  absent() {
    this.leave('device_absent')
    if (this.identity) {
      this.broadcast(new wire.DeviceAbsentMessage(this.options.serial))
    }
    this.registered = false
    this.identity = null
    this.state = null
  }
}
