import type {ReactNode, Ref} from 'react'
import classes from './Page.module.css'

export function Page({className, innerClassName, maxWidth, ref, children}: {
  className?: string
  innerClassName?: string | undefined
  maxWidth?: number
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div ref={ref} className={className ? `${classes.page} ${className}` : classes.page}>
      <div
        className={innerClassName ? `${classes.inner} ${innerClassName}` : classes.inner}
        style={maxWidth ? {maxWidth} : undefined}
      >
        {children}
      </div>
    </div>
  )
}
