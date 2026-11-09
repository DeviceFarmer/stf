import {cleanup, render} from '@testing-library/react'
import {afterEach, describe, expect, it} from 'vitest'
import type {DeviceBrowserApp} from '@/core/devices/types'
import {BrowserIcons} from './cells'

afterEach(() => {
  cleanup()
})

describe('BrowserIcons', () => {
  it('renders SVG icon for bundled browsers and generic globe fallback icon for other browsers', () => {
    const apps: DeviceBrowserApp[] = [
      {
        id: 'com.android.chrome/main'
      , type: 'chrome'
      , name: 'Chrome'
      , developer: 'Google Inc.'
      , selected: true
      , system: false
      }
    , {
        id: 'com.amazon.cloud9/main'
      , type: 'default'
      , name: 'Silk'
      , developer: 'Amazon'
      , selected: false
      , system: true
      }
    ]

    const {container} = render(<BrowserIcons apps={apps} />)

    const chromeImg = container.querySelector('img[src="/static/app/browsers/icon/chrome.svg"]')
    expect(chromeImg).toBeTruthy()
    expect(chromeImg?.getAttribute('title')).toBe('Chrome (Google Inc.)')
    expect(chromeImg?.getAttribute('width')).toBe('18')
    expect(chromeImg?.getAttribute('height')).toBe('18')

    const globe = container.querySelector('svg.tabler-icon-world')
    expect(globe).toBeTruthy()
    expect(globe?.querySelector('title')?.textContent || globe?.getAttribute('aria-label')).toBeTruthy()
  })
})
