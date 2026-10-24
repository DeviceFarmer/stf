import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation, useNavigate} from 'react-router'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Device} from '@/core/devices/types'
import {AuthProviders} from '@/ui/AuthProviders'
import {enhanceDevice} from '@/core/devices/enhance'
import type {Control} from '@/core/control'

const state = vi.hoisted(() => ({
  device: undefined as Device | undefined, invite: vi.fn(), kick: vi.fn(), notify: vi.fn(), standalone: false
  , listeners: new Set<() => void>()
}))
vi.mock('@/core/devices/store', async() => {
  const {useSyncExternalStore} = await import('react')
  return {useDevice: () => ({device: useSyncExternalStore(
    listener => {
      state.listeners.add(listener)
      return () => {
        state.listeners.delete(listener)
      }
    }
    , () => state.device
  ), loading: false})}
})
vi.mock('@/core/group', () => ({inviteDevice: state.invite, kickDevice: state.kick}))
vi.mock('@/core/settings', () => ({setSetting: vi.fn(), useSetting: () => ['dashboard', vi.fn()]}))
vi.mock('@/ui/modes', () => ({basicMode: true, useStandalone: () => state.standalone}))
vi.mock('@/ui/page-title', () => ({usePageTitle: vi.fn()}))
vi.mock('@/ui/notify', () => ({notifyFailure: state.notify}))
vi.mock('@/core/control', () => ({createControl: (_device: Device, _channel: string, readOnly: () => boolean) => ({
  get readOnly() {
    return readOnly()
  }
})}))
vi.mock('./device-control/DeviceControlPanel', () => ({default: ({control}: {control: Control}) =>
  <button data-testid='home' disabled={control.readOnly}>Home</button>}))
import ControlPage from './ControlPage'

function phone(overrides: Partial<Device> = {}): Device {
  return enhanceDevice({serial: 'phone', channel: 'device-channel', present: true, status: 3
    , ready: true, platform: 'Android', usage: 'automation', owner: {email: 'runner@example.test'}
    , group: {id: 'shared', name: 'shared', owner: {email: 'admin@example.test'}}, ...overrides} as Device)
}

function Location() {
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <output data-testid='location'>{location.pathname}{location.search}</output>
    <button data-testid='other-device' onClick={() => navigate('/control/other?mode=watch&standalone')}>
      Open another device
    </button>
  </>
}

describe.each(['Android', 'iOS'])('%s automation viewing session', (platform) => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })
    state.invite.mockReset().mockResolvedValue(undefined)
    state.kick.mockReset().mockResolvedValue(undefined)
    state.notify.mockReset()
    state.standalone = false
    state.device = phone({platform})
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async() => {
    await act(async() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })
  async function render(path = '/control/phone') {
    await act(async() => {
      root.render(<AuthProviders><MemoryRouter initialEntries={[path]}>
        <Location />
        <Routes><Route path='/control/:serial' element={<ControlPage />} /></Routes>
      </MemoryRouter></AuthProviders>)
    })
  }
  function location() {
    return host.querySelector('[data-testid="location"]')!.textContent!
  }
  function home() {
    return host.querySelector<HTMLButtonElement>('[data-testid="home"]')!
  }
  function useButton() {
    return Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Use')!
  }
  async function reload() {
    const path = location()
    await act(async() => root.unmount())
    root = createRoot(host)
    await render(path)
  }
  it('opens automation without an invite and only leaves watch mode after a successful Use', async() => {
    await render()
    expect(location()).toBe('/control/phone?mode=watch')
    expect(host.textContent).toContain('Automated')
    expect(home().disabled).toBe(true)
    expect(state.invite).not.toHaveBeenCalled()
    state.device = phone({platform, owner: null})
    await render()
    expect(host.textContent).toContain('Automation finished')
    expect(state.invite).not.toHaveBeenCalled()
    let accept!: () => void
    state.invite.mockImplementationOnce(() => new Promise<void>(resolve => {
      accept = resolve
    }))
    await act(async() => useButton().click())
    expect(state.invite).toHaveBeenCalledTimes(1)
    expect(location()).toBe('/control/phone?mode=watch')
    expect(home().disabled).toBe(true)
    await act(async() => accept())
    expect(location()).toBe('/control/phone')
    state.device = phone({platform, owner: {email: 'viewer@example.test'}, usage: null, using: true})
    await render()
    expect(home().disabled).toBe(false)
    expect(state.invite).toHaveBeenCalledTimes(1)
  })
  it.each(['before', 'after'])(
    'enables controls when ownership arrives %s the Use reply while navigation is delayed'
    , async(order) => {
      state.device = phone({platform, owner: null, usage: null})
      let accept!: () => void
      state.invite.mockImplementationOnce(() => new Promise<void>(resolve => {
        accept = resolve
      }))
      const router = createMemoryRouter([{path: '*', element: <>
        <Location />
        <Routes><Route path='/control/:serial' element={<ControlPage />} /></Routes>
      </>}], {initialEntries: ['/control/phone?mode=watch&standalone']})
      const blockUseNavigation = ({nextLocation}: {nextLocation: {search: string}}) =>
        !new URLSearchParams(nextLocation.search).has('mode')
      router.getBlocker('handover', blockUseNavigation)
      await act(async() => root.render(<AuthProviders><RouterProvider router={router} /></AuthProviders>))
      await act(async() => useButton().click())
      const publishOwnership = async() => act(async() => {
        state.device = phone({platform, owner: {email: 'viewer@example.test'}, usage: null, using: true})
        state.listeners.forEach(listener => listener())
      })
      if (order === 'before') {
        await publishOwnership()
      }
      await act(async() => accept())
      expect(location()).toBe('/control/phone?mode=watch&standalone')
      if (order === 'after') {
        await publishOwnership()
      }
      expect(home().disabled).toBe(true)
      const blocker = router.getBlocker('handover', blockUseNavigation)
      expect(blocker.state).toBe('blocked')
      await act(async() => blocker.proceed!())
      expect(location()).toBe('/control/phone?standalone=')
      expect(home().disabled).toBe(false)
      expect(host.textContent).not.toContain('Automation finished')
      expect(state.invite).toHaveBeenCalledTimes(1)
      router.deleteBlocker('handover')
      router.dispose()
    }
  )
  it('shows a neutral watch state without acquiring a device when no test was observed', async() => {
    state.device = phone({platform, owner: null, usage: null})
    await render('/control/phone?mode=watch')
    expect(host.textContent).toContain('View only')
    expect(host.textContent).toContain('Take control to view and interact with the device.')
    expect(host.textContent).not.toContain('Automation finished')
    expect(home().disabled).toBe(true)
    expect(useButton().disabled).toBe(false)
    expect(state.invite).not.toHaveBeenCalled()
  })
  it('reports completion only after this watch session observed an actual automation', async() => {
    state.device = phone({platform, owner: null, usage: null})
    await render('/control/phone?mode=watch')
    expect(host.textContent).toContain('View only')
    state.device = phone({platform})
    await render()
    expect(host.textContent).toContain('Automated')
    state.device = phone({platform, owner: null, usage: null})
    await render()
    expect(host.textContent).toContain('Automation finished')
    expect(host.textContent).toContain('The test has finished. Take control to interact with the device.')
    expect(home().disabled).toBe(true)
    expect(state.invite).not.toHaveBeenCalled()
  })
  it('preserves watch intent when reloaded after automation ends', async() => {
    await render('/control/phone?mode=watch')
    state.device = phone({platform, owner: null, usage: null})
    await render()
    expect(host.textContent).toContain('Automation finished')
    await reload()
    expect(location()).toBe('/control/phone?mode=watch')
    expect(host.textContent).toContain('View only')
    expect(host.textContent).not.toContain('Automation finished')
    expect(home().disabled).toBe(true)
    expect(state.invite).not.toHaveBeenCalled()
  })
  it('retains watch mode and allows retry when explicit Use is rejected by a new reservation', async() => {
    state.device = phone({platform, owner: null, usage: null})
    state.invite.mockRejectedValueOnce(new Error('Device is not usable'))
    await render('/control/phone?mode=watch&standalone')
    await act(async() => useButton().click())
    expect(location()).toBe('/control/phone?mode=watch&standalone')
    expect(state.notify).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('View only')
    expect(host.textContent).not.toContain('Automation finished')
    expect(home().disabled).toBe(true)
    state.device = phone({platform, owner: {email: 'next-runner@example.test'}})
    await render()
    expect(host.textContent).toContain('Automated')
    expect(useButton()).toBeUndefined()
    expect(state.invite).toHaveBeenCalledTimes(1)
  })
  it('keeps watching when a new automation arrives before a late Use acknowledgement', async() => {
    state.device = phone({platform, owner: null, usage: null})
    let accept!: () => void
    state.invite.mockImplementationOnce(() => new Promise<void>(resolve => {
      accept = resolve
    }))
    await render('/control/phone?mode=watch')
    await act(async() => useButton().click())
    state.device = phone({platform, owner: {email: 'next-runner@example.test'}})
    await render()
    await act(async() => accept())
    expect(location()).toBe('/control/phone?mode=watch')
    expect(host.textContent).toContain('Automated')
    expect(home().disabled).toBe(true)
    expect(state.invite).toHaveBeenCalledTimes(1)
    await reload()
    expect(state.invite).toHaveBeenCalledTimes(1)
  })
  it('ignores a previous session Use acknowledgement after switching to another watch device', async() => {
    await render('/control/phone?mode=watch')
    state.device = phone({platform, owner: null, usage: null})
    await render()
    expect(host.textContent).toContain('Automation finished')
    let accept!: () => void
    state.invite.mockImplementationOnce(() => new Promise<void>(resolve => {
      accept = resolve
    }))
    await render('/control/phone?mode=watch')
    await act(async() => useButton().click())
    state.device = phone({serial: 'other', platform, owner: null, usage: null})
    await act(async() => host.querySelector<HTMLButtonElement>('[data-testid="other-device"]')!.click())
    expect(location()).toBe('/control/other?mode=watch&standalone')
    await act(async() => accept())
    expect(location()).toBe('/control/other?mode=watch&standalone')
    expect(host.textContent).toContain('View only')
    expect(host.textContent).not.toContain('Automation finished')
    expect(home().disabled).toBe(true)
    expect(state.invite).toHaveBeenCalledTimes(1)
  })
  it('preserves unrelated query parameters after explicit Use', async() => {
    state.device = phone({platform, owner: null, usage: null})
    await render('/control/phone?mode=watch&standalone')
    await act(async() => useButton().click())
    expect(location()).toBe('/control/phone?standalone=')
    expect(state.invite).toHaveBeenCalledTimes(1)
  })
  it('keeps the legacy manual URL and one invite pending while ownership arrives before its reply', async() => {
    let accept!: () => void
    state.invite.mockImplementationOnce(() => new Promise<void>(resolve => {
      accept = resolve
    }))
    state.device = phone({platform, owner: null, usage: null})
    await render()
    expect(state.invite).toHaveBeenCalledTimes(1)
    state.device = phone({platform, owner: {email: 'viewer@example.test'}, usage: null, using: true})
    await render()
    expect(state.invite).toHaveBeenCalledTimes(1)
    await act(async() => accept())
    expect(home().disabled).toBe(false)
    expect(location()).toBe('/control/phone')
  })
  it('does not steal the device when another automation starts immediately after release', async() => {
    await render('/control/phone?mode=watch')
    state.device = phone({platform, owner: null, usage: null})
    await render()
    state.device = phone({platform, owner: {email: 'next-runner@example.test'}})
    await render()
    await reload()
    expect(host.textContent).toContain('Automated')
    expect(state.invite).not.toHaveBeenCalled()
    expect(home().disabled).toBe(true)
  })
  it('does not release a standalone watch session on close, but releases after explicit manual takeover', async() => {
    state.standalone = true
    await render('/control/phone?standalone&mode=watch')
    window.dispatchEvent(new Event('beforeunload'))
    expect(state.kick).not.toHaveBeenCalled()
    state.device = phone({platform, owner: null, usage: null})
    await render()
    await act(async() => useButton().click())
    state.device = phone({platform, owner: {email: 'viewer@example.test'}, usage: null, using: true})
    await render()
    window.dispatchEvent(new Event('beforeunload'))
    expect(state.kick).toHaveBeenCalledWith(state.device)
  })
})
