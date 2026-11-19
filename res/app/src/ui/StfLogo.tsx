import {useComputedColorScheme} from '@mantine/core'

export function StfLogo({size, alt}: {size: 28 | 88, alt: string}) {
  const colorScheme = useComputedColorScheme('light')
  const src = `/static/logo/exports/restored/STF-${size}-${colorScheme}`

  return (
    <picture>
      <source media='(prefers-reduced-motion: no-preference)' type='image/webp' srcSet={src + '.webp'} />
      <img src={src + '.png'} width={size} height={size} alt={alt} style={{display: 'block'}} />
    </picture>
  )
}
