import {renderToStaticMarkup} from 'react-dom/server'
import {MantineProvider} from '@mantine/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {IosDeviceHealth, IosHealthBadge, IosWdaProfileExpiry} from './IosDeviceHealth'
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

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('shows the automatic screen lock warning on an available phone', () => {
    const html = render({...device, ios: {...device.ios!, reason: 'screen_lock_failed'}})
    expect(html).toContain('Automatic screen lock failed after three attempts.')
    expect(html).not.toContain('Preparing the iPhone')
  })

  it('distinguishes ambiguous profiles and missing device data', () => {
    expect(render({...device, ios: {...device.ios!, battery: null, storage: null
      , wda: {...device.ios!.wda, profile: 'ambiguous'}}})).toContain('earliest expiry')
    expect(render({...device, ios: null})).not.toContain('iPhone status')
  })
})

describe('WDA profile expiry on an iPhone card', () => {
  function renderExpiry(phone: Device) {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
      <MantineProvider><IosWdaProfileExpiry device={phone} /></MantineProvider>
    )
    return container
  }

  it.each([
    ['2026-10-20T16:07:25Z', 'gray', '']
    , ['2026-10-20T16:07:26Z', 'yellow', 'expires soon']
    , ['2026-10-22T16:07:26Z', 'red', 'has expired']
  ])('uses the browser-local time and the current warning state at %s', (now, color, warning) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now))
    const expiresAt = device.ios!.wda.expiresAt!
    const container = renderExpiry(device)
    const time = container.querySelector('time')

    expect(time?.getAttribute('datetime')).toBe(expiresAt)
    expect(time?.textContent).toBe(new Date(expiresAt).toLocaleString(undefined, {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }))
    expect(time?.closest('[data-variant="light"]')?.getAttribute('style'))
      .toContain(`--mantine-color-${color}-light`)
    if (warning) {
      expect(container.textContent).toContain(warning)
    }
  })

  it('shows the earliest expiry without claiming the installed profile has expired', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-23T00:00:00Z'))
    const container = renderExpiry({...device, ios: {...device.ios!
      , wda: {...device.ios!.wda, profile: 'ambiguous'}}})
    expect(container.querySelector('time')).not.toBeNull()
    expect(container.textContent).toContain('earliest expiry')
    expect(container.textContent).not.toContain('has expired')
  })

  it('skips Android devices and missing or invalid dates', () => {
    expect(renderExpiry({...device, platform: 'Android'}).querySelector('time')).toBeNull()
    for (const expiresAt of [null, 'invalid']) {
      const container = renderExpiry({...device, ios: {...device.ios!
        , wda: {...device.ios!.wda, expiresAt}}})
      expect(container.querySelector('time')).toBeNull()
    }
  })
})
