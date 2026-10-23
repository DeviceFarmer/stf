import {useEffect, useRef, type ReactNode} from 'react'
import {ActionIcon, Tooltip} from '@mantine/core'
import type {Control} from '@/core/control'
import classes from './DeviceControlPanel.module.css'

export function DeviceControlKey({control, deviceKey, title, children}: {
  control: Control
  deviceKey: string
  title: string
  children: ReactNode
}) {
  const readOnly = control.readOnly
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const element = ref.current
    if (control.readOnly || !element) {
      return undefined
    }

    function up() {
      control.keyUp(deviceKey)
    }

    function down() {
      control.keyDown(deviceKey)
    }

    function touchUp(event: Event) {
      if ((event as TouchEvent).touches.length === 0) {
        element?.removeEventListener('touchleave', touchUp)
        element?.removeEventListener('touchend', touchUp)
        up()
      }
    }

    function mouseUp() {
      element?.removeEventListener('mouseup', mouseUp)
      element?.removeEventListener('mouseleave', mouseUp)
      up()
    }

    function touchStart(event: TouchEvent) {
      event.preventDefault()
      if (event.touches.length === event.changedTouches.length) {
        element?.addEventListener('touchleave', touchUp)
        element?.addEventListener('touchend', touchUp)
        down()
      }
    }

    function mouseDown(event: MouseEvent) {
      event.preventDefault()
      element?.addEventListener('mouseup', mouseUp)
      element?.addEventListener('mouseleave', mouseUp)
      down()
    }

    element.addEventListener('touchstart', touchStart, {passive: false})
    element.addEventListener('mousedown', mouseDown)

    return () => {
      element.removeEventListener('touchstart', touchStart)
      element.removeEventListener('mousedown', mouseDown)
      element.removeEventListener('touchleave', touchUp)
      element.removeEventListener('touchend', touchUp)
      element.removeEventListener('mouseup', mouseUp)
      element.removeEventListener('mouseleave', mouseUp)
    }
  }, [control, deviceKey, readOnly])

  return (
    <Tooltip label={title} openDelay={400} withinPortal>
      <ActionIcon
        ref={ref}
        disabled={control.readOnly}
        variant='subtle'
        color='gray'
        size={40}
        radius='xl'
        className={classes.navKey}
        aria-label={title}
        data-device-control-key={deviceKey}
        device-control-key={deviceKey}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  )
}
