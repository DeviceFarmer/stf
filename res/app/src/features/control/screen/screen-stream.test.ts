import {afterEach, describe, expect, it, vi} from 'vitest'
import type {Device} from '@/core/devices/types'
import {startScreenStream} from './screen-stream'

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor() {
    Socket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  message(data: ArrayBuffer | Blob | string) {
    this.onmessage?.(new MessageEvent('message', {data}))
  }
}

class Chunk {
  constructor(readonly options: EncodedVideoChunkInit) {}
}

class Decoder {
  static instances: Decoder[] = []
  static isConfigSupported = vi.fn(async(_config: VideoDecoderConfig) => ({supported: true}))
  state: CodecState = 'unconfigured'
  decodeQueueSize = 0
  configure = vi.fn((_config: VideoDecoderConfig) => {
    this.state = 'configured'
  })
  decode = vi.fn((_chunk: Chunk) => {
    this.decodeQueueSize += 1
  })
  reset = vi.fn(() => {
    this.decodeQueueSize = 0
    this.state = 'unconfigured'
  })
  close = vi.fn(() => {
    this.state = 'closed'
  })

  constructor(private readonly callbacks: VideoDecoderInit) {
    Decoder.instances.push(this)
  }

  output(timestamp: number, displayWidth = 1170, displayHeight = 2532) {
    const frame = {timestamp, displayWidth, displayHeight, close: vi.fn()}
    this.callbacks.output(frame as unknown as VideoFrame)
    return frame
  }

  fail() {
    this.state = 'closed'
    this.callbacks.error(new DOMException('Could not decode the frame', 'EncodingError'))
  }
}

function enableHevc() {
  Decoder.instances = []
  Decoder.isConfigSupported.mockReset().mockResolvedValue({supported: true})
  vi.stubGlobal('VideoDecoder', Decoder)
  vi.stubGlobal('EncodedVideoChunk', Chunk)
}

const hevcHeader = 'hevc ' + JSON.stringify({codec: 'hvc1.1.6.L123.B0', description: btoa('config')})
const hevcInputReady = 'hevc input ready screen-session'
const accessUnit = (kind: number) => Uint8Array.of(kind, 0, 0, 0, 2, 0x26, 0x01).buffer
const jpegFrame = () => Uint8Array.of(0xff, 0xd8, 0xff, 0xd9).buffer

function fixture(platform = 'iOS', canDecodeHevc = true, overrides: Partial<Device> = {}) {
  if (platform === 'iOS' && canDecodeHevc) {
    enableHevc()
  }
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const bitmap = {width: 100, height: 200, close: vi.fn()}
  const decode = vi.fn().mockResolvedValue(bitmap)
  vi.stubGlobal('createImageBitmap', decode)
  Socket.instances = []
  const getProbeContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const root = document.createElement('div')
  Object.defineProperties(root, {offsetWidth: {value: 400}, offsetHeight: {value: 700}})
  const canvas = document.createElement('canvas')
  const context = {clearRect: vi.fn(), scale: vi.fn(), drawImage: vi.fn()}
  canvas.getContext = vi.fn(() => context) as unknown as typeof canvas.getContext
  const device = {platform, using: true, present: true, ready: true, status: 3
    , display: {width: 1170, height: 2532}, ...overrides} as Device
  const shown = vi.fn(() => true)
  const canControl = vi.fn(() => true)
  const onStatusChange = vi.fn()
  const onDisplayError = vi.fn()
  const onFirstFrame = vi.fn()
  const onInputReady = vi.fn()
  const stream = startScreenStream({url: 'wss://stf.test/screen', root
    , positioner: document.createElement('div'), canvas
    , screen: {rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}}
    , getDevice: () => device, isShown: shown, canControl, onDisplayError, onFirstFrame, onInputReady, onStatusChange})
  return {
    device, stream, root, context, getProbeContext, decode, bitmap, hidden, shown, onStatusChange
  , canControl, onDisplayError, onFirstFrame, onInputReady
  }
}

async function showHevcFrame(socket: Socket) {
  socket.message(hevcHeader)
  socket.message(accessUnit(0))
  await vi.advanceTimersByTimeAsync(0)
  const decoder = Decoder.instances.at(-1)!
  decoder.output(decoder.decode.mock.calls[0]![0].options.timestamp)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('screen stream availability', () => {
  it('marks a lost iPhone stream until a CoreDevice frame is drawn', async() => {
    const {stream, root, context, decode, onStatusChange} = fixture()
    Socket.instances[0]!.open()
    await showHevcFrame(Socket.instances[0]!)
    expect(root.classList.contains('has-frame')).toBe(true)
    Socket.instances[0]!.onerror?.()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    Socket.instances[0]!.close()
    expect(context.clearRect).toHaveBeenCalled()
    expect(root.classList.contains('has-frame')).toBe(false)
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    await vi.advanceTimersByTimeAsync(500)
    Socket.instances[1]!.open()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    Socket.instances[1]!.message(jpegFrame())
    expect(decode).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    await showHevcFrame(Socket.instances[1]!)
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    expect(root.classList.contains('has-frame')).toBe(true)
    stream.stop()
  })

  it('reports Android disconnection without claiming to reconnect or opening another socket', async() => {
    const {stream, onStatusChange} = fixture('Android')
    Socket.instances[0]!.open()
    Socket.instances[0]!.close()
    expect(onStatusChange).toHaveBeenLastCalledWith('disconnected')
    stream.checkEnabled()
    await vi.advanceTimersByTimeAsync(10000)
    expect(Socket.instances).toHaveLength(1)
    stream.stop()
  })

  it('distinguishes an offline device and resumes iPhone recovery when it returns', async() => {
    const {device, stream, onStatusChange} = fixture()
    Socket.instances[0]!.open()
    device.present = false
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('offline')
    Socket.instances[0]!.close()
    await vi.advanceTimersByTimeAsync(1000)
    expect(Socket.instances).toHaveLength(1)
    device.present = true
    device.status = 1
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('offline')
    device.status = 3
    device.ready = false
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('offline')
    device.ready = true
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    await vi.advanceTimersByTimeAsync(500)
    expect(Socket.instances).toHaveLength(2)
    Socket.instances[1]!.open()
    await showHevcFrame(Socket.instances[1]!)
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('waits for a frame from a replacement socket when device metadata recovers', async() => {
    const {device, stream, onStatusChange} = fixture()
    Socket.instances[0]!.open()
    device.ready = false
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('offline')
    expect(Socket.instances[0]!.readyState).toBe(3)
    device.ready = true
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    Socket.instances[1]!.open()
    await showHevcFrame(Socket.instances[1]!)
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('suppresses a connection notice while intentionally hidden or after release', () => {
    const {device, stream, shown, hidden, onStatusChange} = fixture()
    Socket.instances[0]!.open()
    Socket.instances[0]!.close()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    hidden.mockReturnValue(true)
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    hidden.mockReturnValue(false)
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    shown.mockReturnValue(false)
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    shown.mockReturnValue(true)
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    device.using = false
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    device.present = false
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('keeps a secure-content error distinct from connection loss until an actual frame arrives', async() => {
    const {stream, onStatusChange, onDisplayError} = fixture('Android')
    Socket.instances[0]!.open()
    Socket.instances[0]!.message('secure_on')
    expect(onDisplayError).toHaveBeenLastCalledWith('secure')
    Socket.instances[0]!.onerror?.()
    expect(onStatusChange).not.toHaveBeenCalled()
    expect(onDisplayError).toHaveBeenLastCalledWith('secure')
    Socket.instances[0]!.message(new Blob(['unsecured']))
    await Promise.resolve()
    expect(onDisplayError).toHaveBeenLastCalledWith(false)
    expect(onStatusChange).not.toHaveBeenCalled()
    stream.stop()
  })

  it.each(['disconnect', 'hide', 'secure', 'release', 'stop'])('discards a pending bitmap after %s', async(action) => {
    const {device, stream, decode, bitmap, context, shown, onStatusChange, onFirstFrame} = fixture('Android')
    let resolve!: (image: typeof bitmap) => void
    decode.mockImplementationOnce(() => new Promise((accept) => {
      resolve = accept
    }))
    Socket.instances[0]!.open()
    Socket.instances[0]!.message(new Blob(['stale']))
    if (action === 'disconnect') {
      Socket.instances[0]!.close()
    }
    else if (action === 'hide') {
      shown.mockReturnValue(false)
      stream.checkEnabled()
      shown.mockReturnValue(true)
      stream.checkEnabled()
    }
    else if (action === 'secure') {
      Socket.instances[0]!.message('secure_on')
    }
    else if (action === 'release') {
      device.using = false
      stream.checkEnabled()
    }
    else {
      stream.stop()
    }
    resolve(bitmap)
    await Promise.resolve()
    expect(bitmap.close).toHaveBeenCalled()
    expect(context.drawImage).not.toHaveBeenCalled()
    expect(onFirstFrame).not.toHaveBeenCalled()
    if (action === 'disconnect') {
      expect(onStatusChange).toHaveBeenLastCalledWith('disconnected')
    }
    stream.stop()
  })
})

describe('iPhone CoreDevice video', () => {
  it('negotiates on the existing socket and acknowledges only the first displayed video frame', async() => {
    vi.stubGlobal('isSecureContext', true)
    const {stream, context, decode, onInputReady} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    expect(socket.sent.slice(-2)).toEqual(['hevc', 'on'])
    expect(socket.binaryType).toBe('arraybuffer')
    socket.message(jpegFrame())
    socket.message(new Blob([jpegFrame()]))
    expect(context.drawImage).not.toHaveBeenCalled()

    socket.message(hevcHeader)
    socket.message(accessUnit(2))
    socket.message(accessUnit(1))
    await vi.advanceTimersByTimeAsync(0)
    const decoder = Decoder.instances[0]!
    expect(decoder.configure).toHaveBeenCalledWith(expect.objectContaining({
      codec: 'hvc1.1.6.L123.B0', optimizeForLatency: true
    }))
    expect(decoder.decode.mock.calls.map(([chunk]) => chunk.options.type)).toEqual(['key', 'delta'])
    expect(socket.sent).not.toContain('hevc ready')

    const first = decoder.output(decoder.decode.mock.calls[0]![0].options.timestamp)
    decoder.output(decoder.decode.mock.calls[1]![0].options.timestamp)
    expect(context.drawImage).toHaveBeenCalledWith(first, 0, 0, 1170, 2532)
    expect(first.close).toHaveBeenCalledOnce()
    expect(socket.sent.filter(message => message === 'hevc ready')).toHaveLength(1)
    expect(onInputReady).not.toHaveBeenCalled()
    socket.message('hevc input ready invalid token')
    socket.message('hevc input ready invalid\n')
    expect(onInputReady).not.toHaveBeenCalled()
    socket.message(hevcInputReady)
    socket.message('hevc input ready another-session')
    expect(onInputReady).toHaveBeenCalledOnce()
    expect(onInputReady).toHaveBeenLastCalledWith('screen-session')
    expect(decode).not.toHaveBeenCalled()
    stream.stop()
    expect(decoder.close).toHaveBeenCalledOnce()
    expect(onInputReady).toHaveBeenLastCalledWith(null)
  })

  it('draws padded and full HEVC frames into the same touch area', async() => {
    const {stream, context, getProbeContext} = fixture()
    const probe = {drawImage: vi.fn(), getImageData: vi.fn()}
    getProbeContext.mockReturnValue(probe as unknown as CanvasRenderingContext2D)
    function pixels(width: number, height: number, collapsed: boolean) {
      const data = new Uint8ClampedArray(width * height * 4).fill(128)
      const right = collapsed ? Math.round(width * 720 / 1264) : width
      const bottom = collapsed ? Math.round(height * 1280 / 2752) : height
      for (let row = 0; row < bottom; row += 1) {
        const offset = row * width * 4
        data.fill(32, offset, offset + right * 4)
      }
      return {data}
    }
    probe.getImageData
      .mockImplementationOnce((_x: number, _y: number, w: number, h: number) => pixels(w, h, true))
      .mockImplementationOnce((_x: number, _y: number, w: number, h: number) => pixels(w, h, false))
    const socket = Socket.instances[0]!
    socket.open()
    socket.message(hevcHeader)
    socket.message(accessUnit(0))
    await vi.advanceTimersByTimeAsync(0)
    const decoder = Decoder.instances[0]!
    const frame = decoder.output(decoder.decode.mock.calls[0]![0].options.timestamp, 1264, 2752)
    const draw = context.drawImage.mock.calls[0]!
    expect(draw).toEqual([frame, 0, 0, expect.any(Number), expect.any(Number), 0, 0, 1170, 2532])
    expect(Math.abs(draw[3] - 720)).toBeLessThan(15)
    expect(Math.abs(draw[4] - 1280)).toBeLessThan(15)

    socket.message(accessUnit(1))
    const full = decoder.output(decoder.decode.mock.calls[1]![0].options.timestamp, 1264, 2752)
    expect(context.drawImage).toHaveBeenLastCalledWith(full, 0, 0, 1170, 2532)
    stream.stop()
  })

  it('does not start CoreDevice during automation and resumes only for a manual reservation', () => {
    const {device, stream, onDisplayError} = fixture('iOS', true, {
      using: false, usage: 'automation', owner: {email: 'runner@example.test'}
    })
    expect(Socket.instances).toHaveLength(0)
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-automation')
    device.owner = null
    stream.checkEnabled()
    expect(Socket.instances).toHaveLength(0)
    expect(onDisplayError).toHaveBeenLastCalledWith(false)
    device.using = true
    device.usage = null
    stream.checkEnabled()
    Socket.instances[0]!.open()
    expect(Socket.instances[0]!.sent).toEqual(['hevc', 'on'])
    stream.stop()
  })

  it('requests input only when the owner leaves view-only mode and releases it on return', async() => {
    const {stream, canControl, onInputReady} = fixture()
    const socket = Socket.instances[0]!
    canControl.mockReturnValue(false)
    socket.open()
    await showHevcFrame(socket)
    expect(socket.sent).not.toContain('hevc ready')
    socket.message(hevcInputReady)
    expect(onInputReady).not.toHaveBeenCalled()

    canControl.mockReturnValue(true)
    stream.checkEnabled()
    expect(socket.sent.at(-1)).toBe('hevc ready')
    socket.message(hevcInputReady)
    expect(onInputReady).toHaveBeenLastCalledWith('screen-session')

    canControl.mockReturnValue(false)
    stream.checkEnabled()
    expect(onInputReady).toHaveBeenLastCalledWith(null)
    expect(socket.sent.at(-1)).toBe('off')
    expect(socket.readyState).toBe(3)
    const replacement = Socket.instances[1]!
    replacement.open()
    await showHevcFrame(replacement)
    expect(replacement.sent).not.toContain('hevc ready')
    stream.stop()
  })

  it.each([true, false])('ignores an old socket after hiding and showing the screen (close: %s)', async(ackClose) => {
    const {stream, shown, context, onDisplayError, onInputReady} = fixture()
    const previous = Socket.instances[0]!
    previous.open()
    const queuedMessage = previous.onmessage!
    previous.close = () => {
      previous.readyState = 2
    }
    shown.mockReturnValue(false)
    stream.checkEnabled()
    shown.mockReturnValue(true)
    stream.checkEnabled()
    expect(previous.sent.at(-1)).toBe('off')
    expect(Socket.instances).toHaveLength(1)
    if (ackClose) {
      previous.readyState = 3
      previous.onclose?.()
      await vi.advanceTimersByTimeAsync(0)
    }
    else {
      await vi.advanceTimersByTimeAsync(1000)
    }
    const replacement = Socket.instances[1]!
    replacement.open()

    for (const data of [hevcHeader, accessUnit(0), hevcInputReady, 'hevc unavailable']) {
      queuedMessage(new MessageEvent('message', {data}))
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(Decoder.instances).toHaveLength(0)
    expect(context.drawImage).not.toHaveBeenCalled()
    expect(onDisplayError).not.toHaveBeenCalled()
    expect(onInputReady).not.toHaveBeenCalled()
    expect(replacement.sent).toEqual(['hevc', 'on'])

    await showHevcFrame(replacement)
    queuedMessage(new MessageEvent('message', {data: hevcInputReady}))
    expect(onInputReady).not.toHaveBeenCalled()
    replacement.message(hevcInputReady)
    expect(context.drawImage).toHaveBeenCalledOnce()
    expect(replacement.sent).toEqual(['hevc', 'on', 'hevc ready'])
    expect(onInputReady).toHaveBeenLastCalledWith('screen-session')
    stream.stop()
  })

  it('shows a browser capability error without requesting a stream when WebCodecs is missing', () => {
    vi.stubGlobal('VideoDecoder', undefined)
    const {stream, onDisplayError} = fixture('iOS', false)
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-unsupported')
    expect(Socket.instances).toHaveLength(0)
    stream.stop()
  })

  it('identifies an insecure browser origin even if WebCodecs is exposed', () => {
    vi.stubGlobal('isSecureContext', false)
    const {stream, onDisplayError} = fixture()
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-insecure')
    expect(Socket.instances).toHaveLength(0)
    stream.stop()
  })

  it('stops streaming when the actual codec is unsupported and ignores stale video', async() => {
    const {stream, context, decode, onDisplayError} = fixture()
    Decoder.isConfigSupported.mockResolvedValueOnce({supported: false})
    const socket = Socket.instances[0]!
    socket.open()
    socket.message(hevcHeader)
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.sent.at(-1)).toBe('off')
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-unsupported')
    socket.message(accessUnit(0))
    socket.message(jpegFrame())
    expect(decode).not.toHaveBeenCalled()
    expect(context.drawImage).not.toHaveBeenCalled()
    stream.retry()
    expect(socket.sent).toEqual(['hevc', 'on', 'off'])
    stream.stop()
  })

  it('distinguishes unsupported devices from a transient provider failure', async() => {
    const {stream, onDisplayError, onStatusChange} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    socket.message('hevc unavailable')
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-unavailable')
    expect(socket.sent.at(-1)).toBe('off')
    stream.retry()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    const replacement = Socket.instances[1]!
    replacement.open()
    expect(replacement.sent).toEqual(['hevc', 'on'])
    await showHevcFrame(replacement)
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    replacement.message('hevc unsupported')
    expect(onDisplayError).toHaveBeenLastCalledWith('coredevice-unsupported')
    stream.retry()
    expect(replacement.sent.at(-1)).toBe('off')
    expect(Socket.instances).toHaveLength(2)
    stream.stop()
  })

  it.each([true, false])('retries on unlocked telemetry even if the error arrives first: %s', (errorFirst) => {
    const {device, stream, onDisplayError} = fixture()
    device.ios = {locked: null} as NonNullable<Device['ios']>
    const socket = Socket.instances[0]!
    socket.open()
    if (errorFirst) {
      socket.message('hevc unavailable')
      stream.checkEnabled()
      expect(socket.sent).toEqual(['hevc', 'on', 'off'])
    }

    device.ios.locked = false
    stream.checkEnabled()
    if (!errorFirst) {
      socket.message('hevc unavailable')
    }
    const replacement = Socket.instances[1]!
    replacement.open()
    expect(replacement.sent).toEqual(['hevc', 'on'])
    replacement.message('hevc unavailable')
    stream.checkEnabled()
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-unavailable')
    expect(socket.sent).toEqual(['hevc', 'on', 'off'])
    expect(replacement.sent).toEqual(['hevc', 'on', 'off'])
    expect(Socket.instances).toHaveLength(2)
    stream.stop()
  })

  it('drops stalled decode work, requests a keyframe and discards stale output', async() => {
    const {stream, context} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    socket.message(hevcHeader)
    socket.message(accessUnit(0))
    await vi.advanceTimersByTimeAsync(0)
    const decoder = Decoder.instances[0]!
    for (let i = 0; i < 10; i += 1) {
      socket.message(accessUnit(1))
    }
    expect(decoder.decode).toHaveBeenCalledTimes(6)
    expect(decoder.reset).toHaveBeenCalledOnce()
    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(1)
    const stale = decoder.output(decoder.decode.mock.calls[0]![0].options.timestamp)
    expect(stale.close).toHaveBeenCalledOnce()
    expect(context.drawImage).not.toHaveBeenCalled()
    socket.message(accessUnit(0))
    decoder.output(decoder.decode.mock.calls[6]![0].options.timestamp)
    expect(context.drawImage).toHaveBeenCalledOnce()
    stream.stop()
  })

  it('rebuilds an errored decoder from a fresh keyframe on the same socket', async() => {
    const {stream, context, onDisplayError, onInputReady} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    await showHevcFrame(socket)
    socket.message(hevcInputReady)
    const first = Decoder.instances[0]!
    first.fail()

    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(1)
    const replacement = Decoder.instances[1]!
    socket.message(accessUnit(1))
    expect(replacement.decode).not.toHaveBeenCalled()
    const stale = first.output(first.decode.mock.calls[0]![0].options.timestamp)
    expect(stale.close).toHaveBeenCalledOnce()
    expect(context.drawImage).toHaveBeenCalledOnce()
    first.fail()
    expect(Decoder.instances).toHaveLength(2)

    socket.message(accessUnit(0))
    const recovered = replacement.output(replacement.decode.mock.calls[0]![0].options.timestamp)
    expect(context.drawImage).toHaveBeenLastCalledWith(recovered, 0, 0, 1170, 2532)
    expect(socket.readyState).toBe(Socket.OPEN)
    expect(onInputReady.mock.calls).toEqual([['screen-session']])
    expect(onDisplayError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1100)
    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(1)
    stream.stop()
  })

  it('requests one more recovery keyframe when the first request gets no response', async() => {
    const {stream, onDisplayError} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    await showHevcFrame(socket)
    Decoder.instances[0]!.fail()

    await vi.advanceTimersByTimeAsync(1100)
    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(4900)
    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(2)
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-unavailable')
    stream.stop()
  })

  it('stops decoder recovery after repeated errors', async() => {
    const {stream, onDisplayError, onInputReady} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    await showHevcFrame(socket)
    socket.message(hevcInputReady)

    for (let index = 0; index < 3; index += 1) {
      Decoder.instances[index]!.fail()
      socket.message(accessUnit(0))
    }
    expect(Decoder.instances).toHaveLength(3)
    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(2)
    expect(socket.sent.at(-1)).toBe('off')
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-unavailable')
    expect(onInputReady).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('reports a stalled decoder when native video never produces a frame', async() => {
    const {stream, onDisplayError} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    socket.message(hevcHeader)
    await vi.advanceTimersByTimeAsync(6000)
    expect(socket.sent.at(-1)).toBe('off')
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-unavailable')
    expect(Decoder.instances[0]!.close).toHaveBeenCalledOnce()
    stream.stop()
  })
})

describe('iPhone screen recovery', () => {
  it('retries a failed handshake and resumes screen interest on the new socket', async() => {
    const {stream} = fixture()
    Socket.instances[0]!.close()
    await vi.advanceTimersByTimeAsync(500)
    expect(Socket.instances).toHaveLength(2)
    Socket.instances[1]!.open()
    expect(Socket.instances[1]!.sent).toContain('on')
    Socket.instances[1]!.close()
    await vi.advanceTimersByTimeAsync(500)
    Socket.instances[2]!.open()
    expect(Socket.instances[2]!.sent).toContain('on')
    stream.stop()
  })

  it('shows the server automation guard when ownership metadata has not arrived yet', async() => {
    const {stream, onDisplayError, onInputReady} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    socket.message('hevc automation')
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-automation')
    expect(socket.readyState).toBe(3)
    stream.retry()
    await vi.advanceTimersByTimeAsync(10000)
    expect(Socket.instances).toHaveLength(1)
    expect(onInputReady).not.toHaveBeenCalled()
    stream.stop()
  })

  it('stops retrying after release or unmount and preserves Android behaviour', async() => {
    const {device, stream} = fixture()
    Socket.instances[0]!.close()
    device.using = false
    await vi.advanceTimersByTimeAsync(10000)
    expect(Socket.instances).toHaveLength(1)
    stream.stop()
    const next = fixture()
    Socket.instances[0]!.close()
    next.stream.stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(Socket.instances).toHaveLength(1)
    const android = fixture('Android')
    Socket.instances[0]!.close()
    await vi.advanceTimersByTimeAsync(10000)
    expect(Socket.instances).toHaveLength(1)
    android.stream.stop()
  })
})
