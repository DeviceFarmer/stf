import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, useLocation} from 'react-router'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {enhanceDevice} from '@/core/devices/enhance'
import type {Device} from '@/core/devices/types'
import {AuthProviders} from '@/ui/AuthProviders'

const actions = vi.hoisted(() => ({invite: vi.fn(), kick: vi.fn(), release: vi.fn(), confirm: vi.fn()
  , notify: vi.fn(), standalone: vi.fn(), adminMode: false, user: {privilege: 'user'}}))
vi.mock('@/core/group', () => ({inviteDevice: actions.invite, kickDevice: actions.kick, releaseDevice: actions.release}))
vi.mock('@/core/user', () => ({currentUser: actions.user}))
vi.mock('@/ui/modals', () => ({openConfirm: actions.confirm}))
vi.mock('@/ui/modes', () => ({useAdminMode: () => [actions.adminMode]}))
vi.mock('@/ui/notify', () => ({notifyFailure: actions.notify}))
vi.mock('./standalone', () => ({openStandalone: actions.standalone}))
import {controlHref, useDeviceActions} from './device-actions'
import {StatusButton} from './cells'

function phone(overrides: Partial<Device> = {}): Device {
  return enhanceDevice({serial: 'phone', channel: 'channel', present: true, status: 3, ready: true
    , usage: 'automation', owner: {email: 'runner@example.test', reservationId: 'reservation'}, ...overrides} as Device)
}

function Fixture({device}: {device: Device}) {
  const controls = useDeviceActions()
  const location = useLocation()
  return <>
    <a href={controlHref(device)} onClick={(event) => controls.open(event, device)}>Device</a>
    <StatusButton device={device} actions={controls} />
    <output>{location.pathname}{location.search}</output>
  </>
}

function setup(device = phone()) {
  render(<AuthProviders><MemoryRouter initialEntries={['/devices']}><Fixture device={device} /></MemoryRouter></AuthProviders>)
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()})
  actions.user.privilege = 'user'
  actions.adminMode = false
  actions.confirm.mockReset().mockResolvedValue(true)
  actions.release.mockReset().mockResolvedValue(undefined)
  actions.notify.mockReset()
  actions.invite.mockReset().mockResolvedValue(undefined)
  actions.kick.mockReset().mockResolvedValue(undefined)
  actions.standalone.mockReset()
})
afterEach(cleanup)

describe('automation viewer entry points', () => {
  it('puts persistent watch intent in card and name hrefs', () => {
    setup()
    expect(screen.getByRole('link').getAttribute('href')).toBe('#/control/phone?mode=watch')
  })
  it.each(['Device', 'Automated'])('opens %s in watch mode without an ownership request', async(label) => {
    setup()
    fireEvent.click(screen.getByText(label))
    expect(screen.getByRole('status').textContent).toBe('/control/phone?mode=watch')
    expect(actions.invite).not.toHaveBeenCalled()
    expect(actions.kick).not.toHaveBeenCalled()
  })
  it.each([{ctrlKey: true}, {metaKey: true}, {button: 1}])(
    'preserves the watch href for native new-tab clicks: %j', (modifier) => {
      setup()
      fireEvent.click(screen.getByRole('link'), modifier)
      expect(screen.getByRole('status').textContent).toBe('/devices')
      expect(screen.getByRole('link').getAttribute('href')).toBe('#/control/phone?mode=watch')
      expect(actions.invite).not.toHaveBeenCalled()
    }
  )
  it.each(['Device', 'Automated'])('opens %s as a standalone viewer with Shift', (label) => {
    const device = phone()
    setup(device)
    fireEvent.click(screen.getByText(label), {shiftKey: true})
    expect(actions.standalone).toHaveBeenCalledWith(device)
    expect(actions.invite).not.toHaveBeenCalled()
    expect(actions.kick).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('/devices')
  })
  it('retains the manual href and acquire-before-navigation behavior for available devices', async() => {
    setup(phone({owner: null, usage: null}))
    expect(screen.getByRole('link').getAttribute('href')).toBe('#/control/phone')
    fireEvent.click(screen.getByRole('link'))
    expect(actions.invite).toHaveBeenCalledOnce()
    expect(await screen.findByText('/control/phone')).toBeTruthy()
  })
})

describe('administrator Stop Automation action', () => {
  it.each([false, true])('shows a confirmed release action for an actual administrator (admin mode: %s)', async(adminMode) => {
    actions.user.privilege = 'admin'
    actions.adminMode = adminMode
    const device = phone()
    setup(device)
    fireEvent.click(screen.getByRole('button', {name: 'Stop Automation'}))
    await waitFor(() => expect(actions.release).toHaveBeenCalledWith(device))
    expect(actions.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Release this STF reservation? The external automation session must be stopped separately.'
      , danger: true
    }))
    expect(screen.getByRole('status').textContent).toBe('/devices')
    expect(actions.invite).not.toHaveBeenCalled()
    expect(actions.kick).not.toHaveBeenCalled()
  })
  it('does not expose the release action to a non-admin even when local admin mode is enabled', () => {
    actions.adminMode = true
    setup()
    expect(screen.queryByRole('button', {name: 'Stop Automation'})).toBeNull()
    fireEvent.click(screen.getByRole('button', {name: 'Automated'}))
    expect(screen.getByRole('status').textContent).toBe('/control/phone?mode=watch')
    expect(actions.confirm).not.toHaveBeenCalled()
    expect(actions.release).not.toHaveBeenCalled()
  })
  it('keeps name links and Shift-click as watch entry points for administrators', () => {
    actions.user.privilege = 'admin'
    const device = phone()
    setup(device)
    fireEvent.click(screen.getByText('Device'))
    expect(screen.getByRole('status').textContent).toBe('/control/phone?mode=watch')
    fireEvent.click(screen.getByRole('button', {name: 'Stop Automation'}), {shiftKey: true})
    expect(actions.standalone).toHaveBeenCalledWith(device)
    expect(actions.confirm).not.toHaveBeenCalled()
    expect(actions.release).not.toHaveBeenCalled()
  })
  it('leaves the reservation unchanged when confirmation is cancelled', async() => {
    actions.user.privilege = 'admin'
    actions.confirm.mockResolvedValueOnce(false)
    setup()
    const button = screen.getByRole('button', {name: 'Stop Automation'})
    fireEvent.click(button)
    await waitFor(() => expect(button.hasAttribute('data-loading')).toBe(false))
    expect(actions.release).not.toHaveBeenCalled()
    expect(actions.kick).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('/devices')
  })
  it('captures the reservation before confirmation and retains a changed-reservation API rejection', async() => {
    actions.user.privilege = 'admin'
    let confirm!: (value: boolean) => void
    actions.confirm.mockReturnValueOnce(new Promise<boolean>(resolve => {
      confirm = resolve
    }))
    const error = new Error('Device session changed')
    actions.release.mockRejectedValueOnce(error)
    const device = phone()
    setup(device)
    fireEvent.click(screen.getByRole('button', {name: 'Stop Automation'}))
    device.owner!.reservationId = 'replacement'
    confirm(true)
    await waitFor(() => expect(actions.notify).toHaveBeenCalledWith(error, 'Error'))
    expect(actions.release).toHaveBeenCalledWith(expect.objectContaining({
      owner: expect.objectContaining({reservationId: 'reservation'})
    }))
    expect(actions.kick).not.toHaveBeenCalled()
    expect(actions.invite).not.toHaveBeenCalled()
  })
  it('preserves the disconnected status for an absent device retaining old automation ownership', () => {
    actions.user.privilege = 'admin'
    setup(phone({present: false}))
    expect(screen.getByRole('button', {name: 'Disconnected'})).toBeTruthy()
    expect(screen.queryByRole('button', {name: 'Stop Automation'})).toBeNull()
  })
  it('retains Stop Using and the ordinary manual release path outside automation', async() => {
    actions.user.privilege = 'admin'
    const device = phone({usage: null, using: true})
    setup(device)
    fireEvent.click(screen.getByRole('button', {name: 'Stop Using'}))
    await waitFor(() => expect(actions.kick).toHaveBeenCalledWith(device, false))
    expect(actions.confirm).not.toHaveBeenCalled()
    expect(actions.release).not.toHaveBeenCalled()
  })
})
