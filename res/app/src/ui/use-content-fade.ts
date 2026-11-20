import {useLayoutEffect, useRef} from 'react'
import {useReducedMotion} from '@mantine/hooks'

export const contentFadeDuration = 180

export function animateContentFade(element: HTMLElement | null) {
  return element?.animate?.(
    [{opacity: 0.55}, {opacity: 1}]
    , {duration: contentFadeDuration, easing: 'ease-out'}
  )
}

export function useContentFade<T extends HTMLElement>(key: string | undefined) {
  const ref = useRef<T>(null)
  const previous = useRef(key)
  const reducedMotion = useReducedMotion(undefined, {getInitialValueInEffect: false})

  useLayoutEffect(() => {
    const previousKey = previous.current
    previous.current = key
    if (previousKey === undefined || key === undefined || previousKey === key || reducedMotion) {
      return
    }
    const animation = animateContentFade(ref.current)
    return () => animation?.cancel()
  }, [key, reducedMotion])

  return ref
}
