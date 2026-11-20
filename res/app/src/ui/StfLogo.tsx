export function StfLogo({size, alt}: {size: 28 | 88, alt: string}) {
  const src = `/static/logo/exports/devicefarmer-${size}`

  return (
    <img
      srcSet={`${src}.png 1x, ${src}@2x.png 2x`}
      src={src + '.png'}
      width={size}
      height={size}
      alt={alt}
      style={{display: 'block'}}
    />
  )
}
