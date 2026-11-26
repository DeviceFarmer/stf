import {renderToStaticMarkup} from 'react-dom/server'
import {MantineProvider} from '@mantine/core'
import {act, cleanup, fireEvent, render as mount, screen, within} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {IosDeviceHealth, IosHealthBadge} from './IosDeviceHealth'
import type {Device} from '@/core/devices/types'

vi.mock('@/core/i18n', async(importOriginal) => {
  const i18n = await importOriginal<typeof import('@/core/i18n')>()
  const translate = (text: string, params?: Parameters<typeof i18n.translate>[1]) =>
    i18n.translate(text, params, 'en')
  return {useTranslation: () => ({t: translate}), gettext: i18n.gettext, translate}
})

const device = {platform: 'iOS', ready: true, ios: {
  reason: 'ready', name: 'Lab iPhone', battery: {level: 100, charging: false, full: true, externalPower: true}
  , storage: {free: 80 * 1024 ** 3, total: 128 * 1024 ** 3}, telemetryAt: '2026-10-16T12:00:00Z'
  , wda: {version: '16.15.0', profile: 'valid', expiresAt: '2026-10-22T16:07:26Z'}
}} as Device

const render = (phone: Device) => renderToStaticMarkup(
  <MantineProvider><IosDeviceHealth device={phone} /><IosHealthBadge device={phone} /></MantineProvider>
)

describe('iPhone health', () => {
  it('shows real storage and full battery without claiming active charging', () => {
    const html = render(device)
    expect(html).toContain('Lab iPhone')
    expect(html).toContain('100%')
    expect(html).toContain('Full')
    expect(html).not.toContain('Charging')
    expect(html).toContain('80.0 GiB / 128.0 GiB')
    expect(html).toContain('Updated')
    expect(html).toContain('Profile expires')
  })

  it('keeps cached data visible with a specific expiry warning and renewal advice', () => {
    const html = render({...device, ready: false, ios: {...device.ios!, reason: 'wda_profile_expired'
      , wda: {...device.ios!.wda, profile: 'expired'}}})
    expect(html).toContain('Lab iPhone')
    expect(html).toContain('profile has expired')
    expect(html).toContain('rebuild the runner')
  })

  it('distinguishes ambiguous profiles and missing device data', () => {
    expect(render({...device, ios: {...device.ios!, battery: null, storage: null
      , wda: {...device.ios!.wda, profile: 'ambiguous'}}})).toContain('earliest expiry')
    expect(render({...device, ios: null})).not.toContain('iPhone status')
  })
})

describe('iPhone card health badge', () => {
  const lockedPhone = {...device, ios: {...device.ios!, reason: 'locked', locked: true}}
  const badge = (phone: Device) => renderToStaticMarkup(
    <MantineProvider><IosHealthBadge device={phone} /></MantineProvider>
  )

  it('hides routine screen lock for a ready phone', () => {
    expect(badge(lockedPhone)).not.toContain('The iPhone is locked')
  })

  it('retains the lock diagnostic when the phone is not ready', () => {
    expect(badge({...lockedPhone, ready: false})).toContain('The iPhone is locked')
  })

  const wdaWarning = (profile: 'valid' | 'expiring' | 'expired' | 'ambiguous', expiresAt: string | null) =>
    ({...lockedPhone, ios: {...lockedPhone.ios, wda: {...lockedPhone.ios.wda, profile, expiresAt}}})
  const badgeView = (phone: Device) => <MantineProvider env='test'><IosHealthBadge device={phone} /></MantineProvider>

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
    }))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T21:37:26Z'))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps the short WDA warning when the server reports an expired profile', () => {
    expect(badge(wdaWarning('expired', null))).toContain('WDA expired')
  })

  it('uses a generic warning if the expiry date is unavailable', () => {
    expect(badge(wdaWarning('expiring', null))).toContain('WDA expiring')
  })

  it('keeps the same WDA button and open details across unlock, ready and disconnect telemetry', () => {
    const phone = wdaWarning('expiring', '2026-10-22T16:07:26Z')
    const {rerender} = mount(badgeView(phone))
    const warning = screen.getByRole('button', {name: 'WDA · 18h left'})
    fireEvent.click(warning)
    expect(warning.getAttribute('aria-expanded')).toBe('true')

    rerender(badgeView({...phone, ios: {...phone.ios, reason: 'ready', locked: false}}))
    expect(screen.getByRole('button', {name: 'WDA · 18h left'})).toBe(warning)
    expect(screen.getByRole('dialog', {name: 'WDA · 18h left'})).toBeTruthy()

    rerender(badgeView({...phone, ready: false, ios: {...phone.ios, reason: 'disconnected'}}))
    expect(screen.getByRole('button', {name: 'WDA · 18h left'})).toBe(warning)
    expect(screen.getByText('Connect the iPhone by USB.')).toBeTruthy()
    expect(warning.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps confirmed expiry alongside a separate offline diagnostic', () => {
    const phone = wdaWarning('expired', '2026-10-21T15:07:26Z')
    mount(badgeView({...phone, ready: false, ios: {...phone.ios, reason: 'tunnel_unavailable'}}))
    expect(screen.getByRole('button', {name: 'WDA expired'})).toBeTruthy()
    expect(screen.getByText('Waiting for the iPhone USB tunnel.')).toBeTruthy()
  })

  it('shows an ambiguous profile countdown and the earliest date with an explanation', () => {
    const expiresAt = '2026-10-22T02:37:26Z'
    const phone = wdaWarning('ambiguous', expiresAt)
    mount(badgeView({...phone, ios: {...phone.ios, reason: 'wda_profile_unknown'}}))
    const warning = screen.getByRole('button', {name: 'WDA · 5h left'})
    fireEvent.click(warning)
    const details = within(screen.getByRole('dialog'))
    expect(details.getByText(/Several WDA profiles match this device/)).toBeTruthy()
    expect(details.getByText(new Date(expiresAt).toLocaleString()).getAttribute('datetime')).toBe(expiresAt)
  })

  it('keeps a lapsed ambiguous candidate yellow even with an expired reason', () => {
    const phone = wdaWarning('ambiguous', '2026-10-21T20:37:26Z')
    mount(badgeView({...phone, ios: {...phone.ios, reason: 'wda_profile_expired'}}))
    const warning = screen.getByRole('button', {name: 'WDA expiring'})
    expect(warning.style.getPropertyValue('--badge-color')).toContain('--mantine-color-yellow-light')
    expect(screen.queryByRole('button', {name: 'WDA expired'})).toBeNull()
  })

  it('leaves a distant ambiguous profile as an informational diagnostic', () => {
    const phone = wdaWarning('ambiguous', '2026-11-16T21:37:26Z')
    mount(badgeView({...phone, ios: {...phone.ios, reason: 'wda_profile_unknown'}}))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('The WebDriverAgent signing profile could not be identified.')).toBeTruthy()
  })

  it('lets a newly valid profile supersede a stale expiry reason', () => {
    const phone = wdaWarning('valid', '2026-11-16T21:37:26Z')
    mount(badgeView({...phone, ios: {...phone.ios, reason: 'wda_profile_expired'}}))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/profile has expired/)).toBeNull()
  })

  it('calculates the countdown from the current clock on rerender and return to the tab', () => {
    const phone = wdaWarning('valid', '2026-10-22T16:07:26Z')
    const {rerender} = mount(badgeView(phone))
    expect(screen.getByRole('button', {name: 'WDA · 18h left'})).toBeTruthy()

    vi.setSystemTime(new Date('2026-10-22T02:37:26Z'))
    rerender(badgeView(phone))
    expect(screen.getByRole('button', {name: 'WDA · 13h left'})).toBeTruthy()

    vi.setSystemTime(new Date('2026-10-22T04:37:26Z'))
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.getByRole('button', {name: 'WDA · 11h left'})).toBeTruthy()
  })

  it.each(['valid', 'ambiguous'] as const)(
    'shows the warning for a profile marked %s when the tab becomes visible after the 48-hour threshold',
    (profile) => {
      const phone = wdaWarning(profile, '2026-10-23T22:37:26Z')
      mount(badgeView({...phone, ready: false, ios: {...phone.ios, reason: 'disconnected'}}))
      expect(screen.queryByRole('button')).toBeNull()

      vi.setSystemTime(new Date('2026-10-21T23:37:26Z'))
      fireEvent(document, new Event('visibilitychange'))

      expect(screen.getByRole('button', {name: 'WDA · 47h left'})).toBeTruthy()
      expect(screen.getByText('Connect the iPhone by USB.')).toBeTruthy()
    }
  )

  it('starts the warning at 48 hours while the card stays mounted', () => {
    const phone = wdaWarning('valid', '2026-10-23T22:37:26Z')
    mount(badgeView(phone))
    expect(screen.queryByRole('button')).toBeNull()

    act(() => vi.advanceTimersByTime(60 * 60 * 1000))
    expect(screen.getByRole('button', {name: 'WDA · 48h left'})).toBeTruthy()
  })

  it('references a hidden description from the WDA button', () => {
    mount(badgeView(wdaWarning('expired', null)))
    const name = 'WDA expired'
    const description = 'The WebDriverAgent profile has expired. Rebuild and reinstall WDA.'
    const warning = screen.getByRole('button', {name, description})
    const element = document.getElementById(warning.getAttribute('aria-describedby')!)
    expect(element?.hidden).toBe(true)
    expect(element?.textContent).toBe(description)
  })

  it('updates the time left until the profile expires, including while the phone is asleep', () => {
    mount(badgeView(wdaWarning('expiring', '2026-10-22T16:07:26Z')))
    const warning = screen.getByRole('button', {name: 'WDA · 18h left'})
    expect(warning.style.textTransform).toBe('none')
    expect(warning.style.getPropertyValue('--badge-color')).toContain('--mantine-color-yellow-light')
    act(() => vi.advanceTimersByTime(30 * 60 * 1000 + 1))
    expect(screen.getByText('WDA · 17h left')).toBeTruthy()
    for (let hour = 0; hour < 17; hour++) {
      act(() => vi.advanceTimersByTime(60 * 60 * 1000))
    }
    expect(screen.getByText('WDA · <1h left')).toBeTruthy()
    act(() => vi.advanceTimersByTime(60 * 60 * 1000 - 1))
    expect(screen.getByRole('button', {name: 'WDA expired'}).style.getPropertyValue('--badge-color'))
      .toContain('--mantine-color-red-light')
  })
})
