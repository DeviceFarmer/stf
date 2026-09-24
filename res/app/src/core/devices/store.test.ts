import {act, renderHook} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const handlers = new Map<string, Set<(...args: any[]) => void>>()
const requests: string[] = []

function respond(url: string) {
  if (url === '/api/v1/devices') {
    return {devices: [{serial: 'a'}, {serial: 'b'}]}
  }
  if (url === '/api/v1/user/devices') {
    return {devices: []}
  }
  return {device: {serial: url.split('/').pop()}}
}

vi.mock('../socket', () => ({
  onSocket: (event: string, handler: (...args: any[]) => void) => {
    if (!handlers.has(event)) {
      handlers.set(event, new Set())
    }
    handlers.get(event)?.add(handler)
    return () => {
      handlers.get(event)?.delete(handler)
    }
  }
  , emit: () => undefined
}))

vi.mock('../api', () => ({
  api: {
    get: async(url: string) => {
      requests.push(url)
      return respond(url)
    }
  }
}))

const {releaseGracePeriod, useDevice, useDevices, useUserDevices} = await import('./store')

function fire(event: string, payload: unknown) {
  handlers.get(event)?.forEach((handler) => handler(payload))
}

async function advance(ms: number) {
  await act(async() => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function serials(devices: Array<{serial: string}>) {
  return devices.map((device) => device.serial)
}

describe('shared device trackers', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame']})
    requests.length = 0
  })

  afterEach(async() => {
    await advance(releaseGracePeriod)
    vi.useRealTimers()
  })

  it('reuses a released tracker within the grace period and drops it afterwards', async() => {
    const first = renderHook(() => useDevices())
    await advance(50)
    expect(serials(first.result.current.devices)).toEqual(['a', 'b'])
    first.unmount()

    await advance(releaseGracePeriod - 1000)
    const second = renderHook(() => useDevices())
    expect(second.result.current.loading).toBe(false)
    expect(serials(second.result.current.devices)).toEqual(['a', 'b'])
    second.unmount()

    await advance(releaseGracePeriod)
    const third = renderHook(() => useDevices())
    await advance(50)
    expect(serials(third.result.current.devices)).toEqual(['a', 'b'])
    third.unmount()

    expect(requests).toEqual(['/api/v1/devices', '/api/v1/devices'])
  })

  it('reloads the devices in use on every mount instead of keeping them alive', async() => {
    const first = renderHook(() => useUserDevices())
    await advance(50)
    first.unmount()

    const second = renderHook(() => useUserDevices())
    await advance(50)
    second.unmount()

    expect(requests).toEqual(['/api/v1/user/devices', '/api/v1/user/devices'])
  })

  it('loads each group device once for every tracker', async() => {
    const all = renderHook(() => useDevices())
    const user = renderHook(() => useUserDevices())
    await advance(50)
    requests.length = 0

    act(() => fire('device.addGroupDevices', {important: true, devices: ['c', 'd']}))
    await advance(50)

    expect(requests.sort()).toEqual(['/api/v1/devices/c', '/api/v1/devices/d'])
    expect(serials(all.result.current.devices)).toEqual(['a', 'b', 'c', 'd'])
    expect(serials(user.result.current.devices)).toEqual(['c', 'd'])
    all.unmount()
    user.unmount()
  })

  it('keeps a serial tracker to its own device', async() => {
    const single = renderHook(() => useDevice('a'))
    await advance(50)
    requests.length = 0

    act(() => fire('device.addGroupDevices', {important: true, devices: ['c']}))
    await advance(50)

    expect(requests).toEqual([])
    expect(single.result.current.device?.serial).toBe('a')
    single.unmount()
  })
})
