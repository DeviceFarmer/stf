import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it} from 'vitest'
import {StfLogo} from './StfLogo'

describe('StfLogo', () => {
  it.each([
    {size: 28 as const, alt: ''}
  , {size: 88 as const, alt: 'DeviceFarmer'}
  ])('renders a static $size px mark with a 2x PNG source', ({size, alt}) => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<StfLogo size={size} alt={alt} />)

    const image = host.querySelector('img')
    const src = `/static/logo/exports/devicefarmer-${size}`
    expect(host.querySelector('picture, source')).toBeNull()
    expect(image?.getAttribute('src')).toBe(src + '.png')
    expect(image?.getAttribute('srcset')).toBe(`${src}.png 1x, ${src}@2x.png 2x`)
    expect(image?.width).toBe(size)
    expect(image?.height).toBe(size)
    expect(image?.alt).toBe(alt)
  })
})
