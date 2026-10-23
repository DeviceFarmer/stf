import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Device} from '@/core/devices/types'
import {AuthProviders} from '@/ui/AuthProviders'
import {enhanceDevice} from '@/core/devices/enhance'
import type {Control} from '@/core/control'
const state = vi.hoisted(() => ({device: undefined as Device | undefined, invite: vi.fn(), navigate: vi.fn()}))
vi.mock('react-router', () => ({useParams: () => ({serial: 'phone'}), useNavigate: () => state.navigate}))
vi.mock('@/core/devices/store', () => ({useDevice: () => ({device: state.device, loading: false})}))
vi.mock('@/core/group', () => ({inviteDevice: state.invite}))
vi.mock('@/core/settings', () => ({setSetting: vi.fn(), useSetting: () => ['dashboard', vi.fn()]}))
vi.mock('@/ui/modes', () => ({basicMode: true, useStandalone: () => false}))
vi.mock('@/ui/page-title', () => ({usePageTitle: vi.fn()}))
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

describe.each(['Android', 'iOS'])('%s automation viewing session', (platform) => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })
    state.invite.mockReset().mockResolvedValue(undefined)
    state.navigate.mockReset()
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
  async function render() {
    await act(async() => {
      root.render(<AuthProviders><ControlPage /></AuthProviders>)
    })
  }
  it('opens another owner automation without an invite and requires explicit control after release', async() => {
    await render()
    expect(host.textContent).toContain('Automated')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="home"]')!.disabled).toBe(true)
    expect(state.invite).not.toHaveBeenCalled()
    state.device = phone({platform, owner: null})
    await render()
    expect(host.textContent).toContain('Automation finished')
    expect(state.invite).not.toHaveBeenCalled()
    const use = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Use')!
    await act(async() => {
      use.click()
    })
    expect(state.invite).toHaveBeenCalledTimes(1)
    state.device = phone({platform, owner: {email: 'viewer@example.test'}, usage: null, using: true})
    await render()
    expect(host.querySelector<HTMLButtonElement>('[data-testid="home"]')!.disabled).toBe(false)
  })
  it('keeps one manual invite pending while ownership arrives before its reply', async() => {
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
    expect(host.querySelector<HTMLButtonElement>('[data-testid="home"]')!.disabled).toBe(false)
    expect(state.navigate).not.toHaveBeenCalled()
  })
  it('does not steal the device when another automation starts immediately after release', async() => {
    await render()
    state.device = phone({platform, owner: {email: 'next-runner@example.test'}})
    await render()
    expect(host.textContent).toContain('Automated')
    expect(state.invite).not.toHaveBeenCalled()
    expect(host.querySelector<HTMLButtonElement>('[data-testid="home"]')!.disabled).toBe(true)
  })
})
