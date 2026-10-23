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
  onmessage = null
  onerror = null
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
}

function fixture(platform = 'iOS') {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  Socket.instances = []
  const root = document.createElement('div')
  Object.defineProperties(root, {offsetWidth: {value: 400}, offsetHeight: {value: 700}})
  const canvas = document.createElement('canvas')
  canvas.getContext = vi.fn(() => ({})) as unknown as typeof canvas.getContext
  const device = {platform, using: true, present: true, ready: true, status: 3
    , display: {width: 1170, height: 2532}} as Device
  const stream = startScreenStream({url: 'wss://stf.test/screen', root
    , positioner: document.createElement('div'), canvas
    , screen: {rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}}
    , getDevice: () => device, isShown: () => true, onDisplayError: vi.fn(), onFirstFrame: vi.fn()})
  return {device, stream}
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
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
