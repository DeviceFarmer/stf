import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {AuthProviders} from '@/ui/AuthProviders'
import type {Fold4PostureMode} from '../../../../../../lib/types/android-display'
import type {AndroidDisplayState} from '../screen/screen-stream'
import DeviceControlPanel from './DeviceControlPanel'

const {stream, notifyFailure} = vi.hoisted(() => ({
  stream: {publish: null as ((state: AndroidDisplayState | null) => void) | null}
, notifyFailure: vi.fn()
}))

vi.mock('@/core/devices/store', () => ({useUserDevices: () => ({devices: []})}))
vi.mock('@/ui/notify', () => ({notifyFailure}))
vi.mock('../screen/DeviceScreen', async() => {
  const {useEffect} = await import('react')
  function DeviceScreen({onAndroidDisplayChange}: {
    onAndroidDisplayChange?: (state: AndroidDisplayState | null) => void
  }) {
    useEffect(() => {
      stream.publish = onAndroidDisplayChange ?? null
      return () => {
        stream.publish = null
      }
    }, [onAndroidDisplayChange])
    return null
  }
  return {DeviceScreen}
})

const main = {id: 0, width: 1812, height: 2176, rotation: 0, revision: 'unfolded-frame'}
const cover = {id: 0, width: 904, height: 2316, rotation: 0, revision: 'folded-frame'}

describe('Fold4 posture controls', () => {
  const setFold4Posture = vi.fn<(mode: Fold4PostureMode, revision: string) => Promise<void>>()
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    }))
    setFold4Posture.mockReset().mockResolvedValue(undefined)
    notifyFailure.mockReset()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async() => {
    await act(async() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  async function render(readOnly = false, platform = 'Android', standalone = false) {
    const owner = {email: 'operator@example.test'}
    const device: Device = {
      platform, serial: 'foldable', channel: 'foldable-channel', present: true, ready: true, status: 3
      , state: 'using', using: true, owner, group: {id: 'group', name: 'Group', owner}, display: main
      , enhancedName: 'Foldable', enhancedModel: 'Foldable', enhancedImage120: '', enhancedImage24: ''
      , enhancedStateAction: '', enhancedStatePassive: ''
    }
    const control = {readOnly, setFold4Posture} as unknown as Control
    await act(async() => root.render(<AuthProviders><MemoryRouter>
      <DeviceControlPanel device={device} control={control} standalone={standalone} />
    </MemoryRouter></AuthProviders>))
  }

  const postureGroup = () => host.querySelector('[role="group"][aria-label="Foldable posture"]')
  const postureButton = (label: string) =>
    Array.from(postureGroup()!.querySelectorAll('button')).find(button => button.textContent === label)!

  async function publish(posture?: Fold4PostureMode, selected = main) {
    await act(async() => stream.publish!({selected, singleTouch: selected === cover, ...(posture ? {posture} : {})}))
  }

  it('puts advertised posture controls after rotation without a display picker', async() => {
    await render()
    const rotation = host.querySelector('button[aria-label="Rotate Right"]')
    expect(rotation).not.toBeNull()
    await publish()
    expect(postureGroup()).toBeNull()
    await publish('sensor')
    expect(rotation?.parentElement?.nextElementSibling).toBe(postureGroup())
    expect(postureButton('Fold').getAttribute('aria-pressed')).toBe('false')
    expect(postureButton('Unfold').getAttribute('aria-pressed')).toBe('false')
    expect(postureButton('Follow hinge').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[role="group"][aria-label="Display"]')).toBeNull()
    await act(async() => postureButton('Follow hinge').click())
    expect(setFold4Posture).not.toHaveBeenCalled()

    await render(false, 'Android', true)
    await publish('sensor')
    expect(postureGroup()).toBeNull()

    await render(false, 'iOS')
    expect(postureGroup()).toBeNull()
  })

  it('keeps the reported mode while a posture transaction is pending', async() => {
    let complete!: () => void
    setFold4Posture.mockImplementationOnce(() => new Promise<void>(resolve => {
      complete = resolve
    }))
    await render()
    await publish('sensor')
    await act(async() => postureButton('Fold').click())
    expect(setFold4Posture).toHaveBeenCalledExactlyOnceWith('folded', main.revision)
    expect(postureButton('Follow hinge').getAttribute('aria-pressed')).toBe('true')
    expect(postureButton('Fold').getAttribute('aria-pressed')).toBe('false')
    expect(postureButton('Unfold').disabled).toBe(true)
    await act(async() => complete())
    expect(postureButton('Fold').getAttribute('aria-pressed')).toBe('false')

    await publish('folded', cover)
    expect(postureButton('Follow hinge').getAttribute('aria-pressed')).toBe('false')
    expect(postureButton('Fold').getAttribute('aria-pressed')).toBe('true')
    expect(postureButton('Unfold').disabled).toBe(false)
  })

  it('drops pending state on disconnect and ignores a stale transaction failure', async() => {
    let rejectOld!: (error: Error) => void
    let completeNew!: () => void
    setFold4Posture.mockImplementationOnce(() => new Promise<void>((_, reject) => {
      rejectOld = reject
    })).mockImplementationOnce(() => new Promise<void>(resolve => {
      completeNew = resolve
    }))
    await render()
    await publish('sensor')
    await act(async() => postureButton('Fold').click())
    expect(postureButton('Unfold').disabled).toBe(true)
    await act(async() => stream.publish!(null))
    expect(postureGroup()).toBeNull()

    await publish('sensor', cover)
    expect(postureButton('Unfold').disabled).toBe(false)
    await act(async() => postureButton('Unfold').click())
    expect(setFold4Posture).toHaveBeenLastCalledWith('unfolded', cover.revision)
    await act(async() => rejectOld(new Error('Disconnected request')))
    expect(notifyFailure).not.toHaveBeenCalled()
    expect(postureButton('Unfold').disabled).toBe(true)
    await act(async() => completeNew())
    expect(postureButton('Unfold').disabled).toBe(false)
  })

  it('blocks posture changes in read-only Control', async() => {
    await render(true)
    await publish('sensor')
    expect(postureButton('Fold').disabled).toBe(true)
    await act(async() => postureButton('Fold').click())
    expect(setFold4Posture).not.toHaveBeenCalled()
  })
})
