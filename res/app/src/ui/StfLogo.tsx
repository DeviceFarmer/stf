import {useComputedColorScheme} from '@mantine/core'

export function StfLogo({size, alt}: {size: 28 | 88, alt: string}) {
  const colorScheme = useComputedColorScheme('light')
  const src = `/static/logo/exports/restored/STF-${size}-${colorScheme}`

  return (
    <picture>
      <source
        media='(prefers-reduced-motion: no-preference)'
        type='image/webp'
        srcSet={`${src}.webp 1x, ${src}@2x.webp 2x`}
      />
      <img
        srcSet={`${src}.png 1x, ${src}@2x.png 2x`}
        src={src + '.png'}
        width={size}
        height={size}
        alt={alt}
        style={{display: 'block'}}
      />
    </picture>
  )
}
