import {MantineProvider} from '@mantine/core'
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {enhanceDevice} from '@/core/devices/enhance'
import type {Device} from '@/core/devices/types'
import {DeviceIconsView} from './DeviceIconsView'

const expiresAt = '2026-10-22T16:07:26Z'
const recovery = 'The WebDriverAgent profile has expired. Rebuild and reinstall WDA.'

function setup(ready: boolean) {
  const device = enhanceDevice({
    serial: 'phone', platform: 'iOS', present: true, status: 3, ready, owner: null
    , ios: {reason: 'wda_profile_expired', wda: {profile: 'expired', expiresAt}}
  } as Device)
  const actions = {adminMode: false, open: vi.fn(), status: vi.fn(), stop: vi.fn()}
  render(<MantineProvider env='test'><DeviceIconsView devices={[device]} actions={actions} /></MantineProvider>)
  return {actions, badge: screen.getByRole('button', {name: 'WDA expired'})}
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()}))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WDA diagnostics on device cards', () => {
  it('exposes expiry and recovery even when the iPhone cannot be opened', () => {
    const {badge} = setup(false)
    expect(screen.queryByRole('link')).toBeNull()
    expect(badge).toBeInstanceOf(HTMLButtonElement)
    expect(badge.tabIndex).toBe(0)
    const localExpiry = new Date(expiresAt).toLocaleString()
    const description = `${recovery} ${localExpiry}`
    expect(screen.getByRole('button', {name: 'WDA expired', description})).toBe(badge)
    expect(badge.getAttribute('title')).toBe(description)

    act(() => badge.focus())
    expect(document.activeElement).toBe(badge)
    fireEvent.click(badge)
    expect(badge.getAttribute('aria-expanded')).toBe('true')
    const details = within(screen.getByRole('dialog', {name: 'WDA expired'}))
    expect(details.getByText(recovery)).toBeTruthy()
    expect(details.getByText(localExpiry).getAttribute('datetime')).toBe(expiresAt)

    fireEvent.keyDown(badge, {key: 'Escape'})
    expect(badge.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(badge)
  })

  it('opens independently of the device link and dismisses on click or outside touch', () => {
    const {actions, badge} = setup(true)
    expect(screen.getByRole('link').contains(badge)).toBe(false)
    fireEvent.click(badge)
    expect(badge.getAttribute('aria-expanded')).toBe('true')
    expect(actions.open).not.toHaveBeenCalled()
    fireEvent.click(badge)
    expect(badge.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(badge)
    expect(badge.getAttribute('aria-expanded')).toBe('true')
    fireEvent.touchStart(document.body)
    expect(badge.getAttribute('aria-expanded')).toBe('false')
  })
})
