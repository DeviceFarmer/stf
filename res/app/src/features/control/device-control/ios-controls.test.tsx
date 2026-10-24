import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {AuthProviders} from '@/ui/AuthProviders'
import type {Device} from '@/core/devices/types'
import type {Control} from '@/core/control'
import type {DeviceActions} from './use-device-actions'
import {DeviceToolbar} from './DeviceToolbar'
import {DeviceMenuItems} from './DeviceMenuItems'
import {Menu} from '@mantine/core'

vi.mock('@/ui/modes', () => ({useStandalone: () => false}))
vi.mock('@/core/i18n', () => ({
  useTranslation: () => ({t: (text: string) => text}), gettext: (text: string) => text
}))

const device = {serial: 'iphone', platform: 'iOS', enhancedName: 'iPhone 16 Plus'} as Device
const actions = {
  groupDevices: [], rotation: 0, currentRotation: 'portrait', stopUsing: vi.fn()
} as unknown as DeviceActions

describe('iOS controls', () => {
  it('keeps screen visibility and release without offering Android rotation', () => {
    const html = renderToStaticMarkup(
      <AuthProviders>
        <DeviceToolbar device={device} actions={actions} showScreen onToggleScreen={() => {}} />
      </AuthProviders>
    )
    const page = new DOMParser().parseFromString(html, 'text/html')
    expect(page.querySelector('[aria-label="Hide Screen"]')).not.toBeNull()
    expect(page.querySelector('[aria-label="Stop Using"]')).not.toBeNull()
    expect(page.querySelector('[aria-label="Landscape"]')).toBeNull()
    expect(page.querySelector('[aria-label="Rotate Left"]')).toBeNull()
  })

  it('offers Home and screenshots without Android Back or Recents', () => {
    const html = renderToStaticMarkup(
      <AuthProviders><Menu opened keepMounted withinPortal={false}>
        <Menu.Dropdown>
          <DeviceMenuItems device={device} control={{} as Control} onStopUsing={() => {}} />
        </Menu.Dropdown>
      </Menu></AuthProviders>
    )
    expect(html).toContain('Home')
    expect(html).toContain('Save ScreenShot')
    expect(html).not.toContain('Recents')
    expect(html).not.toContain('Rotate Right')
  })

  it('disables device actions while preserving screen visibility during automation', () => {
    const html = renderToStaticMarkup(
      <AuthProviders>
        <DeviceToolbar device={{...device, platform: 'Android'}} actions={actions}
          readOnly showScreen onToggleScreen={() => {}} />
      </AuthProviders>
    )
    const page = new DOMParser().parseFromString(html, 'text/html')
    for (const name of ['Portrait', 'Landscape', 'Rotate Left', 'Rotate Right', 'Stop Using']) {
      expect(page.querySelector(`[aria-label="${name}"]`)?.hasAttribute('disabled')).toBe(true)
    }
    expect(page.querySelector('[aria-label="Hide Screen"]')?.hasAttribute('disabled')).toBe(false)
  })

  it('preserves Android rotation buttons', () => {
    const html = renderToStaticMarkup(
      <AuthProviders>
        <DeviceToolbar device={{...device, platform: 'Android'}} actions={actions}
          showScreen onToggleScreen={() => {}} />
      </AuthProviders>
    )
    expect(html).toContain('aria-label="Landscape"')
    expect(html).toContain('aria-label="Rotate Left"')
  })
})
