import {renderToStaticMarkup} from 'react-dom/server'
import {MantineProvider} from '@mantine/core'
import {describe, expect, it, vi} from 'vitest'
import {IosDeviceHealth, IosHealthBadge} from './IosDeviceHealth'
import type {Device} from '@/core/devices/types'

vi.mock('@/core/i18n', () => ({useTranslation: () => ({t: (text: string) => text})
  , gettext: (text: string) => text, translate: (text: string) => text}))

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

  it.each(['expiring', 'expired'] as const)('keeps the %s WDA warning while asleep', (profile) => {
    const html = badge({...lockedPhone, ios: {...lockedPhone.ios
      , wda: {...lockedPhone.ios.wda, profile}}})
    expect(html).toContain(profile === 'expired' ? 'has expired' : 'expires soon')
    expect(html).not.toContain('The iPhone is locked')
  })
})
