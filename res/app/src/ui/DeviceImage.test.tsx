import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MantineProvider} from '@mantine/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DeviceImage, deviceImageUrl} from './DeviceImage'

describe('DeviceImage', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()
    })))
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async() => {
    await act(async() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  })

  it('falls back after a failed asset and retries when the device changes in either theme', async() => {
    const render = async(src: string, theme: 'light' | 'dark') => {
      await act(async() => root.render(
        <MantineProvider forceColorScheme={theme}>
          <DeviceImage src={src} alt='Test phone' />
        </MantineProvider>
      ))
    }
    for (const theme of ['light', 'dark'] as const) {
      await render('/missing-' + theme + '.webp', theme)
      const image = host.querySelector('img')!
      await act(async() => image.dispatchEvent(new Event('error')))
      expect(host.querySelector('img')?.getAttribute('src')).toBe(deviceImageUrl(null, 'photo/x800'))
      await render('/working-' + theme + '.webp', theme)
      expect(host.querySelector('img')?.getAttribute('src')).toBe('/working-' + theme + '.webp')
      expect(host.querySelector('img')?.getAttribute('alt')).toBe('Test phone')
    }
  })
})
