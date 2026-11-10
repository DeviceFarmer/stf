import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {AuthProviders} from '@/ui/AuthProviders'
import {DeviceScreen} from './DeviceScreen'

vi.mock('./screen-hevc', () => ({
  supportsHevcScreen: () => true
, startHevcScreen: (_header: string, callbacks: {onFrame: (frame: Partial<VideoFrame>) => void}) => ({
    receive: () => callbacks.onFrame({displayWidth: 100, displayHeight: 200})
  , close: () => {}
  })
}))

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  sent: string[] = []
  send(data: string) {
    this.sent.push(data)
  }
  constructor() {
    Socket.instances.push(this)
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  message(data: string | ArrayBuffer | Blob) {
    this.onmessage?.(new MessageEvent('message', {data}))
  }
  frame(platform: string) {
    if (platform === 'iOS') {
      this.message('hevc {}')
      this.message(new ArrayBuffer(2))
    }
    else {
      this.message(new Blob(['frame']))
    }
  }
}

describe('screen availability notice', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let device: Device
  const control = {readOnly: true} as Control

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('WebSocket', Socket)
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 100, height: 200, close: vi.fn()}))
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(700)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(), scale: vi.fn(), drawImage: vi.fn()
    } as unknown as CanvasRenderingContext2D)
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })
    Socket.instances = []
    device = {platform: 'iOS', using: false, usage: 'automation', owner: {email: 'runner@example.test'}
      , present: true, ready: true, status: 3
      , battery: {health: 'good', level: 80, scale: 100, source: 'usb', status: 'charging'
        , temp: 25, voltage: 4000}
      , display: {url: 'wss://stf.test/screen', width: 100, height: 200}} as Device
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async() => {
    await act(async() => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function render(showScreen = true, screenControl = control) {
    await act(async() => root.render(
      <AuthProviders><DeviceScreen device={device} control={screenControl} showScreen={showScreen} /></AuthProviders>
    ))
  }

  it.each(['iOS', 'Android'])('labels a lost %s stream and waits for a replacement frame to clear recovery', async(platform) => {
    device.platform = platform
    await render()
    await act(async() => {
      Socket.instances[0]!.open()
      Socket.instances[0]!.frame(platform)
    })
    await act(async() => Socket.instances[0]!.close())
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      platform === 'iOS' ? 'Reconnecting…' : 'Screen disconnected'
    )
    expect(host.querySelector('.has-frame')).toBeNull()
    if (platform === 'iOS') {
      await act(async() => vi.advanceTimersByTimeAsync(500))
      await act(async() => Socket.instances[1]!.open())
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Reconnecting…')
      await act(async() => Socket.instances[1]!.frame(platform))
      expect(host.querySelector('[role="status"]')).toBeNull()
      expect(host.querySelector('.has-frame')).not.toBeNull()
    }
    else {
      await act(async() => vi.advanceTimersByTimeAsync(10000))
      expect(Socket.instances).toHaveLength(1)
    }
  })

  it('updates on physical availability, hides notices with the screen and clears them after release', async() => {
    await render()
    await act(async() => Socket.instances[0]!.open())
    device = {...device, present: false}
    await render()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Device offline')
    await render(false)
    expect(host.querySelector('[role="status"]')).toBeNull()
    await render()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Device offline')
    device = {...device, owner: null, usage: null}
    await render()
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('lets an iPhone automation viewer retry a temporary video failure without enabling input', async() => {
    await render()
    const socket = Socket.instances[0]!
    await act(async() => {
      socket.open()
      socket.message('hevc unavailable')
    })
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('The iPhone screen could not be opened.')
    const retry = alert?.querySelector('button')
    expect(retry?.disabled).toBe(false)
    await act(async() => retry?.click())
    expect(socket.sent.slice(-2)).toEqual(['hevc', 'on'])
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await act(async() => socket.frame('iOS'))
    expect(socket.sent).not.toContain('hevc ready')
  })

  it('waits for a physical unlock before resuming CoreDevice video', async() => {
    device = {...device, ios: {locked: true} as NonNullable<Device['ios']>}
    await render()
    const socket = Socket.instances[0]!
    await act(async() => socket.open())
    expect(socket.sent).toEqual([])
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unlock it on the device.')

    device = {...device, ios: {...device.ios!, locked: false}}
    await render()
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(socket.sent.slice(-2)).toEqual(['hevc', 'on'])
    await act(async() => socket.frame('iOS'))
    expect(host.querySelector('[role="status"]')).toBeNull()

    device = {...device, ios: {...device.ios!, locked: true}}
    await render()
    expect(socket.sent.at(-1)).toBe('off')
    expect(host.querySelector('.has-frame')).toBeNull()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unlock it on the device.')
  })

  it('gates iPhone pointer input until the provider binds it and releases a held touch on failure', async() => {
    device = {...device, using: true, usage: null}
    const manual = {readOnly: false, gestureStart: vi.fn(), gestureStop: vi.fn()
      , touchDown: vi.fn(), touchCommit: vi.fn(), touchReset: vi.fn()}
    await render(true, manual as unknown as Control)
    const socket = Socket.instances[0]!
    await act(async() => {
      socket.open()
      socket.frame('iOS')
    })
    const screen = host.querySelector('.device-screen')!
    const down = () => screen.dispatchEvent(new MouseEvent('mousedown', {
      clientX: 100, clientY: 100, cancelable: true
    }))
    expect(socket.sent.at(-1)).toBe('hevc ready')
    down()
    expect(manual.touchDown).not.toHaveBeenCalled()

    await act(async() => socket.message('hevc input ready'))
    down()
    expect(manual.touchDown).toHaveBeenCalledOnce()
    await act(async() => socket.message('hevc unavailable'))
    expect(manual.touchReset).toHaveBeenCalledOnce()
    down()
    expect(manual.touchDown).toHaveBeenCalledOnce()
  })

  it('skips screen checks for battery updates with the same owner and rechecks owner changes', async() => {
    await render()
    await act(async() => Socket.instances[0]!.open())
    const measure = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
    measure.mockClear()
    device = {...device, owner: {...device.owner!}, battery: {...device.battery!, level: 75}}
    await render()
    expect(measure).not.toHaveBeenCalled()
    expect(Socket.instances).toHaveLength(1)

    device = {...device, owner: {...device.owner!, email: 'next-runner@example.test'}}
    await render()
    expect(measure).toHaveBeenCalled()

    device = {...device, ready: false}
    await render()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Device offline')
  })
})
