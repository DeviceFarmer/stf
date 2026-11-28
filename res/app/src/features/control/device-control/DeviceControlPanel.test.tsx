import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {AuthProviders} from '@/ui/AuthProviders'
import type {FoldablePostureMode} from '../../../../../../lib/types/android-display'
import type {Ref} from 'react'
import type {AndroidDisplayState, FoldSwitchScreen} from '../screen/screen-stream'
import DeviceControlPanel from './DeviceControlPanel'

const {stream, notifyFailure} = vi.hoisted(() => ({
  stream: {
    publish: null as ((state: AndroidDisplayState | null) => void) | null
  , ready: null as ((revision: string | null) => void) | null
  , prepare: vi.fn()
  , accept: vi.fn()
  , cancel: vi.fn()
  }
, notifyFailure: vi.fn()
}))

vi.mock('@/core/devices/store', () => ({useUserDevices: () => ({devices: []})}))
vi.mock('@/ui/notify', () => ({notifyFailure}))
vi.mock('../screen/DeviceScreen', async() => {
  const {useEffect, useImperativeHandle} = await import('react')
  function DeviceScreen({onAndroidDisplayChange, onAndroidInputReady, foldSwitchRef}: {
    onAndroidDisplayChange?: (state: AndroidDisplayState | null) => void
    onAndroidInputReady?: (revision: string | null) => void
    foldSwitchRef?: Ref<FoldSwitchScreen>
  }) {
    useImperativeHandle(foldSwitchRef, () => ({
      prepareFoldSwitch: stream.prepare
    , acceptFoldSwitch: stream.accept
    , cancelFoldSwitch: stream.cancel
    }), [])
    useEffect(() => {
      stream.publish = onAndroidDisplayChange ?? null
      stream.ready = onAndroidInputReady ?? null
      return () => {
        stream.publish = null
        stream.ready = null
      }
    }, [onAndroidDisplayChange, onAndroidInputReady])
    return null
  }
  return {DeviceScreen}
})

const main = {id: 0, width: 1812, height: 2176, rotation: 0, revision: 'unfolded-frame'}
const cover = {id: 0, width: 904, height: 2316, rotation: 0, revision: 'folded-frame'}

function accepted(mode: FoldablePostureMode, revision: string) {
  return {body: {mode, revision}}
}

type PostureConfirmation = ReturnType<typeof accepted>

describe('Foldable posture controls', () => {
  const setFoldablePosture = vi.fn<(mode: FoldablePostureMode, revision: string) => Promise<PostureConfirmation>>()
  const rotate = vi.fn<(rotation: number) => void>()
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    }))
    setFoldablePosture.mockReset()
    rotate.mockReset()
    stream.prepare.mockReset().mockImplementation(() => {
      stream.ready?.(null)
      return true
    })
    stream.accept.mockReset()
    stream.cancel.mockReset()
    notifyFailure.mockReset()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async() => {
    await act(async() => root.unmount())
    host.remove()
    vi.useRealTimers()
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
    const control = {readOnly, setFoldablePosture, rotate} as unknown as Control
    await act(async() => root.render(<AuthProviders><MemoryRouter>
      <DeviceControlPanel device={device} control={control} standalone={standalone} />
    </MemoryRouter></AuthProviders>))
  }

  const postureGroup = () => host.querySelector('[role="group"][aria-label="Foldable posture"]')
  const postureButton = (label: string) =>
    Array.from(postureGroup()!.querySelectorAll('button')).find(button => button.textContent === label)!
  const toolbarButton = (label: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

  async function publish(posture?: FoldablePostureMode, selected = main, ready = true) {
    await act(async() => {
      stream.publish!({selected, singleTouch: selected === cover, ...(posture ? {posture} : {})})
      if (ready) {
        stream.ready!(selected.revision)
      }
    })
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
    expect(setFoldablePosture).not.toHaveBeenCalled()

    await render(false, 'Android', true)
    await publish('sensor')
    expect(postureGroup()).toBeNull()

    await render(false, 'iOS')
    expect(postureGroup()).toBeNull()
  })

  it('locks the posture controls until the confirmed panel finishes drawing', async() => {
    let complete!: (result: PostureConfirmation) => void
    setFoldablePosture.mockImplementationOnce(() => new Promise(resolve => {
      complete = resolve
    }))
    await render()
    await publish('sensor')
    await act(async() => postureButton('Fold').click())
    expect(stream.prepare).toHaveBeenCalledExactlyOnceWith('folded')
    expect(setFoldablePosture).toHaveBeenCalledExactlyOnceWith('folded', main.revision)
    expect(postureGroup()?.getAttribute('aria-busy')).toBe('true')
    expect(postureButton('Follow hinge').getAttribute('aria-pressed')).toBe('true')
    expect(postureButton('Fold').getAttribute('aria-pressed')).toBe('false')
    expect(postureButton('Fold').hasAttribute('data-pending')).toBe(true)
    expect(postureButton('Unfold').hasAttribute('data-pending')).toBe(false)
    expect(postureButton('Unfold').disabled).toBe(true)
    expect(toolbarButton('Landscape').disabled).toBe(true)
    expect(toolbarButton('Rotate Left').disabled).toBe(true)
    expect(toolbarButton('Stop Using').disabled).toBe(false)
    await act(async() => complete(accepted('folded', cover.revision)))
    expect(stream.accept).toHaveBeenCalledExactlyOnceWith(cover.revision)
    expect(postureGroup()?.getAttribute('aria-busy')).toBe('true')
    expect(postureButton('Unfold').disabled).toBe(true)

    await publish('folded', cover, false)
    expect(postureButton('Follow hinge').getAttribute('aria-pressed')).toBe('false')
    expect(postureButton('Fold').getAttribute('aria-pressed')).toBe('true')
    await act(async() => stream.ready!(main.revision))
    expect(postureButton('Unfold').disabled).toBe(true)
    await act(async() => stream.ready!(cover.revision))
    expect(postureGroup()?.getAttribute('aria-busy')).toBe('false')
    expect(postureButton('Unfold').disabled).toBe(false)
    expect(toolbarButton('Landscape').disabled).toBe(false)
  })

  it('rotates from the streamed Foldable angle and waits for a matching frame', async() => {
    vi.useFakeTimers()
    await render()
    const landscape = {...main, rotation: 90, revision: 'landscape-frame'}
    await publish('sensor', landscape)
    expect(toolbarButton('Landscape').getAttribute('aria-pressed')).toBe('true')
    expect(toolbarButton('Portrait').getAttribute('aria-pressed')).toBe('false')
    await act(async() => toolbarButton('Rotate Left').click())
    expect(rotate).toHaveBeenLastCalledWith(180)

    expect(toolbarButton('Portrait').disabled).toBe(true)
    expect(postureButton('Fold').disabled).toBe(true)
    await act(async() => toolbarButton('Portrait').click())
    expect(rotate).toHaveBeenCalledExactlyOnceWith(180)
    await act(async() => vi.advanceTimersByTimeAsync(400))
    expect(toolbarButton('Landscape').getAttribute('aria-pressed')).toBe('true')

    await publish('sensor', main, false)
    expect(toolbarButton('Rotate Right').disabled).toBe(true)
    await act(async() => stream.ready!(main.revision))
    expect(toolbarButton('Rotate Right').disabled).toBe(false)
    expect(toolbarButton('Portrait').getAttribute('aria-pressed')).toBe('true')

    await act(async() => stream.ready!(null))
    expect(toolbarButton('Rotate Right').disabled).toBe(true)
    expect(toolbarButton('Stop Using').disabled).toBe(false)
    await act(async() => stream.publish!(null))
    expect(toolbarButton('Rotate Right').disabled).toBe(true)
    await publish('sensor')
    expect(toolbarButton('Rotate Right').disabled).toBe(false)
  })

  it('lets the operator retry a rotation when no new frame arrives', async() => {
    vi.useFakeTimers()
    await render()
    await publish('sensor')
    await act(async() => toolbarButton('Landscape').click())
    expect(rotate).toHaveBeenCalledExactlyOnceWith(90)
    expect(toolbarButton('Rotate Right').disabled).toBe(true)
    await act(async() => vi.advanceTimersByTimeAsync(5000))
    expect(toolbarButton('Rotate Right').disabled).toBe(false)
    await act(async() => toolbarButton('Rotate Right').click())
    expect(rotate).toHaveBeenLastCalledWith(270)
  })

  it('finishes Follow hinge when a newer verified revision is ready', async() => {
    setFoldablePosture.mockResolvedValue(accepted('sensor', cover.revision))
    await render()
    await publish('folded', cover)
    await act(async() => postureButton('Follow hinge').click())
    expect(stream.prepare).toHaveBeenCalledExactlyOnceWith('sensor')
    expect(stream.accept).toHaveBeenCalledExactlyOnceWith(cover.revision)
    expect(postureGroup()?.getAttribute('aria-busy')).toBe('true')

    await publish('sensor', main)
    expect(postureGroup()?.getAttribute('aria-busy')).toBe('false')
    expect(postureButton('Follow hinge').getAttribute('aria-pressed')).toBe('true')
    expect(postureButton('Fold').disabled).toBe(false)
  })

  it('drops pending state on disconnect and ignores a stale transaction failure', async() => {
    let rejectOld!: (error: Error) => void
    let completeNew!: (result: PostureConfirmation) => void
    setFoldablePosture.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectOld = reject
    })).mockImplementationOnce(() => new Promise(resolve => {
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
    expect(setFoldablePosture).toHaveBeenLastCalledWith('unfolded', cover.revision)
    await act(async() => rejectOld(new Error('Disconnected request')))
    expect(notifyFailure).not.toHaveBeenCalled()
    expect(postureButton('Unfold').disabled).toBe(true)
    await act(async() => completeNew(accepted('unfolded', main.revision)))
    await publish('unfolded')
    expect(postureButton('Unfold').disabled).toBe(false)
  })

  it('reports a missing frame and ends the loading state without enabling screen input', async() => {
    vi.useFakeTimers()
    setFoldablePosture.mockResolvedValue(accepted('folded', cover.revision))
    await render()
    await publish('sensor')
    await act(async() => postureButton('Fold').click())
    expect(postureGroup()?.getAttribute('aria-busy')).toBe('true')
    await act(async() => vi.advanceTimersByTimeAsync(5000))
    expect(stream.cancel).toHaveBeenCalledExactlyOnceWith()
    expect(notifyFailure).toHaveBeenCalledExactlyOnceWith(new Error('Foldable screen did not become ready'),
      'Foldable posture')
    expect(postureGroup()?.getAttribute('aria-busy')).toBe('false')
    expect(postureButton('Unfold').disabled).toBe(true)
  })

  it('blocks posture changes in read-only Control', async() => {
    await render(true)
    await publish('sensor')
    expect(postureButton('Fold').disabled).toBe(true)
    await act(async() => postureButton('Fold').click())
    expect(setFoldablePosture).not.toHaveBeenCalled()
  })
})
