import {cleanup, fireEvent, render, screen} from '@testing-library/react'
import {MemoryRouter, useLocation} from 'react-router'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {enhanceDevice} from '@/core/devices/enhance'
import type {Device} from '@/core/devices/types'

const actions = vi.hoisted(() => ({invite: vi.fn(), kick: vi.fn(), standalone: vi.fn()}))
vi.mock('@/core/group', () => ({inviteDevice: actions.invite, kickDevice: actions.kick}))
vi.mock('@/ui/modes', () => ({useAdminMode: () => [false]}))
vi.mock('@/ui/notify', () => ({notifyFailure: vi.fn()}))
vi.mock('./standalone', () => ({openStandalone: actions.standalone}))
import {controlHref, useDeviceActions} from './device-actions'

function phone(overrides: Partial<Device> = {}): Device {
  return enhanceDevice({serial: 'phone', channel: 'channel', present: true, status: 3, ready: true
    , usage: 'automation', owner: {email: 'runner@example.test'}, ...overrides} as Device)
}

function Fixture({device}: {device: Device}) {
  const controls = useDeviceActions()
  const location = useLocation()
  return <>
    <a href={controlHref(device)} onClick={(event) => controls.open(event, device)}>Device</a>
    <button onClick={(event) => controls.status(event, device)}>Automated</button>
    <output>{location.pathname}{location.search}</output>
  </>
}

function setup(device = phone()) {
  render(<MemoryRouter initialEntries={['/devices']}><Fixture device={device} /></MemoryRouter>)
}

beforeEach(() => {
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
