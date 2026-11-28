import {afterEach, describe, expect, it, onTestFinished, vi} from 'vitest'
import type {Device} from '@/core/devices/types'
import {startScreenStream, type ScreenGeometry} from './screen-stream'

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

function fixture(platform = 'iOS', canDecodeHevc = true, overrides: Partial<Device> = {}, wdaScreen = false) {
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
  const getOtherCanvasContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
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
  const onWdaInputReady = vi.fn()
  const onAndroidDisplay = vi.fn()
  const onAndroidInputReady = vi.fn()
  const screen: ScreenGeometry = {rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}}
  const stream = startScreenStream({url: 'wss://stf.test/screen', root
    , positioner: document.createElement('div'), canvas
    , screen
    , wdaScreen
    , getDevice: () => device, isShown: shown, canControl, onDisplayError, onFirstFrame
    , onInputReady, onWdaInputReady, onStatusChange, onAndroidDisplay, onAndroidInputReady})
  return {
    device, stream, root, canvas, context, getOtherCanvasContext, decode, bitmap, hidden, shown, onStatusChange
  , canControl, onDisplayError, onFirstFrame, onInputReady, onWdaInputReady, onAndroidDisplay
  , onAndroidInputReady, screen
  }
}

function foldFixture(reducedMotion = false) {
  const owner = {email: 'operator@example.test', reservationId: 'reservation-one'}
  const view = fixture('Android', true, {owner})
  Object.defineProperties(view.canvas, {offsetWidth: {value: 300}, offsetHeight: {value: 400}})
  vi.stubGlobal('matchMedia', () => ({matches: reducedMotion}))
  const snapshotContext = {drawImage: vi.fn()}
  view.getOtherCanvasContext.mockReturnValue(snapshotContext as unknown as CanvasRenderingContext2D)

  const prototype = HTMLCanvasElement.prototype
  const previousAnimate = Object.getOwnPropertyDescriptor(prototype, 'animate')
  const animate = vi.fn((_keyframes: Keyframe[], _options: KeyframeAnimationOptions) => ({
    cancel: vi.fn(), onfinish: null as (() => void) | null
  }))
  Object.defineProperty(prototype, 'animate', {value: animate, configurable: true})
  onTestFinished(() => {
    if (previousAnimate) {
      Object.defineProperty(prototype, 'animate', previousAnimate)
    }
    else {
      Reflect.deleteProperty(prototype, 'animate')
    }
  })

  const socket = Socket.instances[0]!
  socket.open()
  const unfolded = {id: 0, width: 1812, height: 2176, rotation: 0, revision: 'inner'}
  const folded = {...unfolded, width: 904, height: 2316, revision: 'outer'}
  const announce = (display: typeof unfolded, posture = 'folded') => socket.message('displays ' +
    JSON.stringify({selected: display, singleTouch: display === folded, posture, projection: true}))
  const start = (display: typeof unfolded) => socket.message('start ' +
    JSON.stringify({display, quirks: {alwaysUpright: false}}))
  async function frame() {
    socket.message(new Blob([jpegFrame()], {type: 'image/jpeg'}))
    await vi.advanceTimersByTimeAsync(0)
  }
  return {...view, animate, snapshotContext, socket, unfolded, folded, announce, start, frame}
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

describe('Android display stream', () => {
  it('publishes only valid Foldable posture metadata and clears it on disconnect', () => {
    const {stream, onAndroidDisplay} = fixture('Android')
    const socket = Socket.instances[0]!
    socket.open()
    const main = {id: 0, width: 1080, height: 2400, rotation: 0, revision: 'main-display'}
    const metadata = {selected: main, singleTouch: false}
    const announce = (state: unknown) => socket.message('displays ' + JSON.stringify(state))

    announce({...metadata, ids: [0, 2]})
    expect(onAndroidDisplay).toHaveBeenLastCalledWith(metadata)
    announce({...metadata, posture: 'unfolded'})
    expect(onAndroidDisplay).toHaveBeenLastCalledWith({...metadata, posture: 'unfolded'})
    announce({...metadata, posture: 'unsupported'})
    expect(onAndroidDisplay).toHaveBeenLastCalledWith(metadata)
    socket.close()
    expect(onAndroidDisplay).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('drops pending JPEGs when the primary display changes geometry', async() => {
    const {stream, context, decode, bitmap, screen, onAndroidInputReady} = fixture('Android')
    const socket = Socket.instances[0]!
    socket.open()
    const main = {id: 0, width: 1812, height: 2176, rotation: 0, revision: 'unfolded-frame'}
    const folded = {id: 0, width: 904, height: 2316, rotation: 90, revision: 'folded-frame'}
    const announce = (selected: typeof main) => socket.message('displays ' +
      JSON.stringify({selected, singleTouch: selected === folded}))
    const start = (display: typeof main) => socket.message('start ' +
      JSON.stringify({display, quirks: {alwaysUpright: false}}))
    const jpeg = new Blob([jpegFrame()], {type: 'image/jpeg'})

    announce(main)
    start(main)
    socket.message(jpeg)
    await vi.advanceTimersByTimeAsync(0)
    expect(onAndroidInputReady).toHaveBeenLastCalledWith(main.revision)
    const mainScaler = screen.inputScaler

    let finishDecode!: (image: typeof bitmap) => void
    decode.mockReturnValueOnce(new Promise(resolve => {
      finishDecode = resolve
    }))
    socket.message(jpeg)

    announce(folded)
    start(main)
    socket.message(jpeg)
    finishDecode(bitmap)
    await vi.advanceTimersByTimeAsync(0)
    expect(context.drawImage).toHaveBeenCalledOnce()
    expect(decode).toHaveBeenCalledTimes(2)
    expect(onAndroidInputReady).toHaveBeenLastCalledWith(null)
    expect(screen.rotation).toBe(folded.rotation)
    expect(screen.inputScaler).not.toBe(mainScaler)

    start(folded)
    socket.message(jpeg)
    await vi.advanceTimersByTimeAsync(0)
    expect(context.drawImage).toHaveBeenCalledTimes(2)
    expect(onAndroidInputReady).toHaveBeenLastCalledWith(folded.revision)
    stream.stop()
  })

  it('does not show or enable touch on frames from a secondary display', async() => {
    const {stream, decode, onAndroidDisplay, onAndroidInputReady} = fixture('Android')
    const socket = Socket.instances[0]!
    socket.open()
    const selected = {id: 2, width: 800, height: 600, rotation: 0, revision: 'secondary'}
    const primary = {...selected, id: 0, revision: 'primary'}
    const jpeg = new Blob([jpegFrame()], {type: 'image/jpeg'})
    const announce = (display: typeof selected) => socket.message('displays ' +
      JSON.stringify({selected: display, singleTouch: false}))
    const start = (display: typeof selected) => socket.message('start ' +
      JSON.stringify({display, quirks: {alwaysUpright: false}}))

    announce(selected)
    start(selected)
    socket.message(jpeg)
    await vi.advanceTimersByTimeAsync(0)
    expect(onAndroidDisplay).toHaveBeenLastCalledWith(null)
    expect(decode).not.toHaveBeenCalled()
    expect(onAndroidInputReady).not.toHaveBeenCalled()

    announce(primary)
    start({...selected, revision: primary.revision})
    socket.message(jpeg)
    await vi.advanceTimersByTimeAsync(0)
    expect(decode).not.toHaveBeenCalled()

    start(primary)
    socket.message(jpeg)
    await vi.advanceTimersByTimeAsync(0)
    expect(decode).toHaveBeenCalledOnce()
    expect(onAndroidInputReady).toHaveBeenLastCalledWith(primary.revision)
    stream.stop()
  })
})

describe('Foldable panel transition', () => {
  it('freezes before the command and buffers a matching frame until the provider confirms it', async() => {
    const view = foldFixture()
    view.announce(view.unfolded, 'sensor')
    view.start(view.unfolded)
    await view.frame()
    expect(view.socket.sent.filter(message => message.startsWith('size inner '))).toHaveLength(1)
    expect(view.stream.prepareFoldSwitch('folded')).toBe(true)
    expect(view.stream.prepareFoldSwitch('folded')).toBe(false)
    await view.frame()
    expect(view.decode).toHaveBeenCalledOnce()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(null)

    view.announce(view.folded)
    view.start(view.folded)
    await view.frame()
    expect(view.socket.sent.filter(message => message.startsWith('size outer '))).toHaveLength(1)
    expect(view.decode).toHaveBeenCalledOnce()
    expect(view.animate).not.toHaveBeenCalled()

    view.stream.acceptFoldSwitch(view.folded.revision)
    await vi.advanceTimersByTimeAsync(0)
    expect(view.decode).toHaveBeenCalledTimes(2)
    expect(view.animate).toHaveBeenCalledTimes(2)
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(null)
    view.animate.mock.results[1]!.value.onfinish?.()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(view.folded.revision)
    view.stream.stop()
  })

  it('restores input immediately when the confirmed panel stayed the same', async() => {
    const view = foldFixture()
    view.announce(view.unfolded, 'unfolded')
    view.start(view.unfolded)
    await view.frame()
    expect(view.stream.prepareFoldSwitch('sensor')).toBe(true)
    view.announce(view.unfolded, 'sensor')
    view.stream.acceptFoldSwitch(view.unfolded.revision)
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(view.unfolded.revision)
    expect(view.animate).not.toHaveBeenCalled()
    expect(view.decode).toHaveBeenCalledOnce()
    view.stream.stop()
  })

  it.each(['before', 'after'])('uses a newer hinge frame announced %s the acknowledgement', async(order) => {
    const view = foldFixture()
    view.announce(view.unfolded, 'unfolded')
    view.start(view.unfolded)
    await view.frame()
    expect(view.stream.prepareFoldSwitch('sensor')).toBe(true)

    const confirmed = {...view.unfolded, revision: 'hinge-confirmed'}
    view.announce(confirmed, 'sensor')
    if (order === 'after') {
      view.stream.acceptFoldSwitch(confirmed.revision)
    }
    view.announce(view.folded, 'sensor')
    view.start(view.folded)
    await view.frame()
    if (order === 'before') {
      expect(view.animate).not.toHaveBeenCalled()
      view.stream.acceptFoldSwitch(confirmed.revision)
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(view.animate).toHaveBeenCalledTimes(2)
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(null)
    view.animate.mock.results[1]!.value.onfinish?.()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(view.folded.revision)
    view.stream.stop()
  })

  it('keeps waiting when the acknowledged hinge revision has not appeared on this stream', async() => {
    const view = foldFixture()
    view.announce(view.unfolded, 'unfolded')
    view.start(view.unfolded)
    await view.frame()
    expect(view.stream.prepareFoldSwitch('sensor')).toBe(true)
    view.stream.acceptFoldSwitch('missing-revision')
    view.announce(view.folded, 'sensor')
    view.start(view.folded)
    await view.frame()

    expect(view.decode).toHaveBeenCalledOnce()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(null)
    view.stream.stop()
  })

  it('uses the final canvas angle immediately for revisioned rotation', async() => {
    const view = foldFixture()
    expect(view.root.classList.contains('revisioned-rotation')).toBe(false)
    view.announce(view.unfolded, 'sensor')
    expect(view.root.classList.contains('revisioned-rotation')).toBe(true)
    view.start(view.unfolded)
    await view.frame()

    const landscape = {...view.unfolded, rotation: 90, revision: 'landscape'}
    view.announce(landscape, 'sensor')
    view.start(landscape)
    await view.frame()
    expect(view.canvas.style.transform).toBe('rotate(-90deg)')
    expect(view.screen.rotation).toBe(90)
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(landscape.revision)
    view.stream.stop()
    expect(view.root.classList.contains('revisioned-rotation')).toBe(false)
  })

  it('holds the old frame until the new panel draws, then crossfades before enabling input', async() => {
    const view = foldFixture()
    view.announce(view.unfolded, 'unfolded')
    view.start(view.unfolded)
    await view.frame()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith('inner')

    view.announce(view.folded)
    view.start(view.unfolded)
    await view.frame()
    expect(view.root.classList.contains('has-frame')).toBe(true)
    expect(view.context.drawImage).toHaveBeenCalledOnce()
    expect(view.animate).not.toHaveBeenCalled()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(null)

    view.start(view.folded)
    await view.frame()
    const previous = view.root.querySelector<HTMLCanvasElement>('.fold-transition-frame')!
    expect(previous.style.width).toBe('300px')
    expect(previous.style.height).toBe('400px')
    expect(previous.getAttribute('aria-hidden')).toBe('true')
    expect(view.snapshotContext.drawImage).toHaveBeenCalledExactlyOnceWith(view.canvas, 0, 0)
    expect(view.animate.mock.calls.map(([, animation]) => animation.duration)).toEqual([250, 250])
    await view.frame()
    expect(view.animate).toHaveBeenCalledTimes(2)
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(null)

    view.animate.mock.results[1]!.value.onfinish?.()
    expect(view.root.querySelector('.fold-transition-frame')).toBeNull()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith('outer')
    view.stream.stop()
  })

  it.each([
    {reason: 'when the panel stays the same', reducedMotion: false}
  , {reason: 'with reduced motion enabled', reducedMotion: true}
  ])('skips the fade $reason', async({reducedMotion}) => {
    const view = foldFixture(reducedMotion)
    view.announce(view.unfolded)
    view.start(view.unfolded)
    await view.frame()

    const next = reducedMotion ? view.folded : {...view.unfolded, revision: 'new-revision'}
    view.announce(next, 'sensor')
    view.start(next)
    await view.frame()
    expect(view.animate).not.toHaveBeenCalled()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(next.revision)
    view.stream.stop()
  })

  it('removes the outgoing frame on a secure display event without enabling input', async() => {
    const view = foldFixture()
    view.announce(view.unfolded)
    view.start(view.unfolded)
    await view.frame()
    view.announce(view.folded)
    view.start(view.folded)
    await view.frame()
    expect(view.root.querySelector('.fold-transition-frame')).not.toBeNull()

    const outgoing = view.animate.mock.results[1]!.value
    view.socket.message('secure_on')
    expect(outgoing.cancel).toHaveBeenCalledOnce()
    expect(outgoing.onfinish).toBeNull()
    expect(view.root.querySelector('.fold-transition-frame')).toBeNull()
    expect(view.onAndroidInputReady).toHaveBeenLastCalledWith(null)
    view.stream.stop()
  })
})

describe('iPhone WDA video', () => {
  it('draws JPEG video without WebCodecs, clears input on disconnect and waits for a replacement frame', async() => {
    const {stream, context, decode, bitmap, onDisplayError, onInputReady, onWdaInputReady, onStatusChange} =
      fixture('iOS', false, {ios: {locked: true} as NonNullable<Device['ios']>}, true)
    const socket = Socket.instances[0]!
    socket.open()
    expect(socket.binaryType).toBe('blob')
    expect(socket.sent).toEqual(['on'])
    const jpeg = new Blob([jpegFrame()], {type: 'image/jpeg'})
    socket.message(jpeg)
    await vi.advanceTimersByTimeAsync(0)
    expect(decode).toHaveBeenCalledWith(jpeg)
    expect(context.drawImage).toHaveBeenCalledOnce()
    expect(onWdaInputReady).toHaveBeenCalledExactlyOnceWith(true)
    expect(onDisplayError).not.toHaveBeenCalled()
    expect(onInputReady).not.toHaveBeenCalled()

    let finishDecode!: (image: typeof bitmap) => void
    decode.mockReturnValueOnce(new Promise(resolve => {
      finishDecode = resolve
    }))
    socket.message(jpeg)
    socket.close()
    finishDecode(bitmap)
    await vi.advanceTimersByTimeAsync(500)
    expect(context.drawImage).toHaveBeenCalledOnce()
    expect(onWdaInputReady).toHaveBeenLastCalledWith(false)
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    const replacement = Socket.instances[1]!
    replacement.open()
    expect(replacement.sent).toEqual(['on'])
    replacement.message(jpeg)
    await vi.advanceTimersByTimeAsync(0)
    expect(context.drawImage).toHaveBeenCalledTimes(2)
    expect(onWdaInputReady).toHaveBeenLastCalledWith(true)
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('stops manual video when automation takes the reservation', async() => {
    const {stream, device, onDisplayError, onWdaInputReady} = fixture('iOS', false,
      {owner: {email: 'owner@example.test'}}, true)
    const socket = Socket.instances[0]!
    socket.open()
    socket.message(new Blob([jpegFrame()]))
    await vi.advanceTimersByTimeAsync(0)
    device.usage = 'automation'
    stream.checkEnabled()
    expect(socket.sent).toEqual(['on', 'off'])
    expect(socket.readyState).toBe(3)
    expect(onWdaInputReady).toHaveBeenLastCalledWith(false)
    expect(onDisplayError).toHaveBeenLastCalledWith('hevc-automation')
    await vi.advanceTimersByTimeAsync(5000)
    expect(Socket.instances).toHaveLength(1)
    stream.stop()
  })
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

  it('draws complete portrait frames across resolution changes after landscape registration', async() => {
    const {stream, context, getOtherCanvasContext, onInputReady} = fixture('iOS', true, {
      display: {width: 2532, height: 1170, rotation: 90} as NonNullable<Device['display']>
    })
    const socket = Socket.instances[0]!
    socket.open()
    socket.message(hevcHeader)
    socket.message(accessUnit(0))
    await vi.advanceTimersByTimeAsync(0)
    const decoder = Decoder.instances[0]!
    const frame = decoder.output(decoder.decode.mock.calls[0]![0].options.timestamp, 1264, 2752)
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(frame, 0, 0, 1264, 2752)
    expect(socket.sent).toContain('hevc ready')
    socket.message(hevcInputReady)
    expect(onInputReady).toHaveBeenLastCalledWith('screen-session')

    socket.message(accessUnit(1))
    const full = decoder.output(decoder.decode.mock.calls[1]![0].options.timestamp, 720, 1280)
    expect(context.drawImage).toHaveBeenLastCalledWith(full, 0, 0, 720, 1280)
    expect(getOtherCanvasContext).not.toHaveBeenCalled()
    stream.stop()
  })

  it('closes on a landscape frame and reopens when it can draw a portrait frame', async() => {
    const {stream, context, onInputReady} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    await showHevcFrame(socket)
    socket.message(hevcInputReady)
    socket.message(accessUnit(1))
    const decoder = Decoder.instances[0]!
    decoder.output(decoder.decode.mock.calls[1]![0].options.timestamp, 2532, 1170)
    expect(context.drawImage).toHaveBeenCalledOnce()
    expect(onInputReady.mock.calls).toEqual([['screen-session'], [null]])
    expect(socket.sent.at(-1)).toBe('off')
    await vi.advanceTimersByTimeAsync(500)
    const replacement = Socket.instances[1]!
    replacement.open()
    await showHevcFrame(replacement)
    replacement.message(hevcInputReady)
    expect(context.drawImage).toHaveBeenCalledTimes(2)
    expect(onInputReady).toHaveBeenLastCalledWith('screen-session')
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
    expect(onDisplayError).not.toHaveBeenCalled()
    expect(socket.sent.at(-1)).toBe('off')
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    await vi.advanceTimersByTimeAsync(500)
    const replacement = Socket.instances[1]!
    replacement.open()
    expect(replacement.sent).toEqual(['hevc', 'on'])
    await showHevcFrame(replacement)
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    replacement.message('hevc unsupported')
    expect(onDisplayError).toHaveBeenLastCalledWith('coredevice-unsupported')
    stream.retry()
    await vi.advanceTimersByTimeAsync(10000)
    expect(replacement.sent.at(-1)).toBe('off')
    expect(Socket.instances).toHaveLength(2)
    stream.stop()
  })

  it.each([true, false])('retries on unlocked telemetry even if the error arrives first: %s', (errorFirst) => {
    const {device, stream, onStatusChange} = fixture()
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
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
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
    await vi.advanceTimersByTimeAsync(1100)
    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(2)
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
    const {stream, onStatusChange} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    await showHevcFrame(socket)
    Decoder.instances[0]!.fail()

    await vi.advanceTimersByTimeAsync(1100)
    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(4900)
    expect(socket.sent.filter(message => message === 'hevc keyframe')).toHaveLength(2)
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    stream.stop()
  })

  it('stops decoder recovery after repeated errors', async() => {
    const {stream, onStatusChange, onInputReady} = fixture()
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
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    expect(onInputReady).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('reports a stalled decoder when native video never produces a frame', async() => {
    const {stream, onStatusChange} = fixture()
    const socket = Socket.instances[0]!
    socket.open()
    socket.message(hevcHeader)
    await vi.advanceTimersByTimeAsync(6000)
    expect(socket.sent.at(-1)).toBe('off')
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
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
    await vi.advanceTimersByTimeAsync(1000)
    Socket.instances[2]!.open()
    expect(Socket.instances[2]!.sent).toContain('on')
    stream.stop()
  })

  it.each([false, true])('shows the server automation guard before ownership metadata (WDA: %s)',
    async(wdaScreen) => {
      const {stream, onDisplayError, onInputReady, onWdaInputReady} = fixture('iOS', !wdaScreen, {}, wdaScreen)
      const socket = Socket.instances[0]!
      socket.open()
      socket.message('hevc automation')
      expect(onDisplayError).toHaveBeenLastCalledWith('hevc-automation')
      expect(socket.readyState).toBe(3)
      stream.retry()
      await vi.advanceTimersByTimeAsync(10000)
      expect(Socket.instances).toHaveLength(1)
      expect(onInputReady).not.toHaveBeenCalled()
      expect(onWdaInputReady).not.toHaveBeenCalled()
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
