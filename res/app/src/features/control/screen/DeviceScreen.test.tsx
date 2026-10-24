import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {AuthProviders} from '@/ui/AuthProviders'
import {DeviceScreen} from './DeviceScreen'

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  send() {}
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
  frame() {
    this.onmessage?.(new MessageEvent('message', {data: new Blob(['frame'])}))
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

  async function render(showScreen = true) {
    await act(async() => root.render(
      <AuthProviders><DeviceScreen device={device} control={control} showScreen={showScreen} /></AuthProviders>
    ))
  }

  it.each(['iOS', 'Android'])('labels a lost %s stream and waits for a replacement frame to clear recovery', async(platform) => {
    device.platform = platform
    await render()
    await act(async() => {
      Socket.instances[0]!.open()
      Socket.instances[0]!.frame()
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
      await act(async() => Socket.instances[1]!.frame())
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
})
