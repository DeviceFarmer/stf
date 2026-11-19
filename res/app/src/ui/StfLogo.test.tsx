import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MantineProvider} from '@mantine/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {StfLogo} from './StfLogo'

describe('StfLogo', () => {
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

  it('switches theme assets and offers animation only when reduced motion is off', async() => {
    const render = async(theme: 'light' | 'dark') => {
      await act(async() => root.render(
        <MantineProvider forceColorScheme={theme}>
          <StfLogo size={28} alt='' />
          <StfLogo size={88} alt='STF' />
        </MantineProvider>
      ))
    }
    for (const theme of ['light', 'dark'] as const) {
      await render(theme)

      const logos = host.querySelectorAll('picture')
      const sizes = [28, 88]
      expect(logos).toHaveLength(sizes.length)
      logos.forEach((logo, index) => {
        const size = sizes[index]
        const src = `/static/logo/exports/restored/STF-${size}-${theme}`
        const still = logo.querySelector('img')
        const animated = logo.querySelector('source')

        expect(still?.getAttribute('src')).toBe(src + '.png')
        expect(still?.width).toBe(size)
        expect(still?.height).toBe(size)
        expect(still?.alt).toBe(size === 28 ? '' : 'STF')
        expect(animated?.getAttribute('srcset')).toBe(src + '.webp')
        expect(animated?.getAttribute('type')).toBe('image/webp')
        expect(animated?.getAttribute('media')).toBe('(prefers-reduced-motion: no-preference)')
      })
    }
  })
})
