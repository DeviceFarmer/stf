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
  message(data: Blob | string) {
    this.onmessage?.(new MessageEvent('message', {data}))
  }
}

function fixture(platform = 'iOS') {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const bitmap = {width: 100, height: 200, close: vi.fn()}
  const decode = vi.fn().mockResolvedValue(bitmap)
  vi.stubGlobal('createImageBitmap', decode)
  Socket.instances = []
  const root = document.createElement('div')
  Object.defineProperties(root, {offsetWidth: {value: 400}, offsetHeight: {value: 700}})
  const canvas = document.createElement('canvas')
  const context = {clearRect: vi.fn(), scale: vi.fn(), drawImage: vi.fn()}
  canvas.getContext = vi.fn(() => context) as unknown as typeof canvas.getContext
  const device = {platform, using: true, present: true, ready: true, status: 3
    , display: {width: 1170, height: 2532}} as Device
  const shown = vi.fn(() => true)
  const onStatusChange = vi.fn()
  const onDisplayError = vi.fn()
  const onFirstFrame = vi.fn()
  const stream = startScreenStream({url: 'wss://stf.test/screen', root
    , positioner: document.createElement('div'), canvas
    , screen: {rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}}
    , getDevice: () => device, isShown: shown, onDisplayError, onFirstFrame, onStatusChange})
  return {device, stream, root, context, decode, bitmap, hidden, shown, onStatusChange, onDisplayError, onFirstFrame}
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('screen stream availability', () => {
  it('marks a lost iPhone stream until a frame is drawn, rather than clearing on handshake or failed decode', async() => {
    const {stream, root, context, decode, onStatusChange} = fixture()
    Socket.instances[0]!.open()
    Socket.instances[0]!.message(new Blob(['frame']))
    await Promise.resolve()
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
    decode.mockRejectedValueOnce(new Error('invalid jpeg'))
    Socket.instances[1]!.message(new Blob(['invalid']))
    await Promise.resolve()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    Socket.instances[1]!.message(new Blob(['recovered']))
    await Promise.resolve()
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
    Socket.instances[1]!.message(new Blob(['recovered']))
    await Promise.resolve()
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('does not clear the offline notice merely because device metadata recovers while the socket stays open', async() => {
    const {device, stream, onStatusChange} = fixture()
    Socket.instances[0]!.open()
    device.ready = false
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('offline')
    device.ready = true
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    Socket.instances[0]!.message(new Blob(['recovered']))
    await Promise.resolve()
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('suppresses a connection notice while intentionally hidden or after automation ends', () => {
    const {device, stream, shown, hidden, onStatusChange} = fixture()
    device.using = false
    device.owner = {email: 'runner@example.test'}
    device.usage = 'automation'
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
    device.owner = null
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    device.present = false
    stream.checkEnabled()
    expect(onStatusChange).toHaveBeenLastCalledWith(null)
    stream.stop()
  })

  it('keeps a secure-content error distinct from connection loss until an actual frame arrives', async() => {
    const {stream, onStatusChange, onDisplayError} = fixture()
    Socket.instances[0]!.open()
    Socket.instances[0]!.message('secure_on')
    expect(onDisplayError).toHaveBeenLastCalledWith('secure')
    Socket.instances[0]!.close()
    expect(onStatusChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    Socket.instances[1]!.open()
    expect(onDisplayError).toHaveBeenLastCalledWith('secure')
    Socket.instances[1]!.message(new Blob(['unsecured']))
    await Promise.resolve()
    expect(onDisplayError).toHaveBeenLastCalledWith(false)
    expect(onStatusChange).not.toHaveBeenCalled()
    stream.stop()
  })

  it.each(['reconnect', 'hide', 'secure', 'release', 'stop'])('discards a pending bitmap after %s', async(action) => {
    const {device, stream, decode, bitmap, context, shown, onStatusChange, onFirstFrame} = fixture()
    let resolve!: (image: typeof bitmap) => void
    decode.mockImplementationOnce(() => new Promise((accept) => {
      resolve = accept
    }))
    Socket.instances[0]!.open()
    Socket.instances[0]!.message(new Blob(['stale']))
    if (action === 'reconnect') {
      Socket.instances[0]!.close()
      await vi.advanceTimersByTimeAsync(500)
      Socket.instances[1]!.open()
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
    if (action === 'reconnect') {
      expect(onStatusChange).toHaveBeenLastCalledWith('reconnecting')
    }
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

  it('streams a non-owner automation view and reconnects without claiming the device', async() => {
    const {device, stream} = fixture()
    device.using = false
    device.owner = {email: 'runner@example.test'}
    device.usage = 'automation'
    Socket.instances[0]!.open()
    expect(Socket.instances[0]!.sent).toContain('on')
    Socket.instances[0]!.close()
    await vi.advanceTimersByTimeAsync(500)
    expect(Socket.instances).toHaveLength(2)
    Socket.instances[1]!.open()
    expect(Socket.instances[1]!.sent).toContain('on')
    device.owner = null
    Socket.instances[1]!.close()
    await vi.advanceTimersByTimeAsync(10000)
    expect(Socket.instances).toHaveLength(2)
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
