import {cleanup, fireEvent, render, screen} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AuthProviders} from '@/ui/AuthProviders'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {NavigationCard} from './NavigationCard'

vi.mock('@/core/i18n', () => ({
  useTranslation: () => ({t: (text: string) => text})
, gettext: (text: string) => text
, translate: (text: string) => text
}))

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
  matches: false
, addEventListener: vi.fn()
, removeEventListener: vi.fn()
})))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NavigationCard', () => {
  const mockDevice: Device = {
    serial: 'test-device-1'
  , name: 'Pixel 8'
  , browser: {
      selected: true
    , apps: [
        {
          id: 'com.android.chrome/com.google.android.apps.chrome.Main'
        , type: 'chrome'
        , name: 'Chrome'
        , developer: 'Google Inc.'
        , selected: true
        , system: false
        }
      , {
          id: 'com.amazon.cloud9/com.amazon.cloud9.Main'
        , type: 'default'
        , name: 'Silk'
        , developer: 'Amazon'
        , selected: false
        , system: true
        }
      , {
          id: 'com.unknown.browser/com.unknown.Main'
        , type: 'unknown-type'
        , name: 'Custom Browser'
        , selected: false
        , system: false
        }
      ]
    }
  } as unknown as Device

  const mockControl = {
    openBrowser: vi.fn().mockResolvedValue(true)
  , clearBrowser: vi.fn().mockResolvedValue(true)
  } as unknown as Control

  it('renders SVG icon for bundled browsers and generic globe fallback icon for other browsers', () => {
    const {container} = render(
      <AuthProviders>
        <NavigationCard device={mockDevice} control={mockControl} />
      </AuthProviders>
    )

    // Chrome pill should have SVG image
    const chromeImg = container.querySelector('img[src="/static/app/browsers/icon/chrome.svg"]')
    expect(chromeImg).toBeTruthy()

    // Silk pill should NOT have an img tag; should have generic globe icon (.tabler-icon-world)
    const silkButton = screen.getByRole('button', {name: /Silk/})
    expect(silkButton.querySelector('img')).toBeNull()
    expect(silkButton.querySelector('svg.tabler-icon-world')).toBeTruthy()

    // Custom Browser pill should also have generic globe icon fallback
    const customButton = screen.getByRole('button', {name: /Custom Browser/})
    expect(customButton.querySelector('img')).toBeNull()
    expect(customButton.querySelector('svg.tabler-icon-world')).toBeTruthy()
  })

  it('selects browser pill on click', () => {
    render(
      <AuthProviders>
        <NavigationCard device={mockDevice} control={mockControl} />
      </AuthProviders>
    )

    const silkButton = screen.getByRole('button', {name: /Silk/})
    expect(silkButton.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(silkButton)
    expect(silkButton.getAttribute('aria-pressed')).toBe('true')
  })
})
