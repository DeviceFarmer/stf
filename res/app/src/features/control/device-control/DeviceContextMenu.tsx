import {useState, type MouseEvent, type ReactNode} from 'react'
import {Menu} from '@mantine/core'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {DeviceMenuItems} from './DeviceMenuItems'
import classes from './DeviceControlPanel.module.css'

interface MenuPosition {
  x: number
  y: number
}

export function DeviceContextMenu({device, control, onStopUsing, children}: {
  device: Device
  control: Control
  onStopUsing: () => void
  children: ReactNode
}) {
  const [position, setPosition] = useState<MenuPosition | null>(null)

  function openMenu(event: MouseEvent) {
    event.preventDefault()
    setPosition({x: event.clientX, y: event.clientY})
  }

  function close() {
    setPosition(null)
  }

  return (
    <div className={`${classes.contextArea} stf-device-context-menu`} onContextMenu={openMenu}>
      {children}
      <Menu
        opened={position !== null}
        onChange={(opened) => !opened && close()}
        position='bottom-start'
        offset={2}
        shadow='md'
        width={210}
        withinPortal
      >
        <Menu.Target>
          <div
            className={classes.contextAnchor}
            style={position ? {left: position.x, top: position.y} : undefined}
          />
        </Menu.Target>
        <Menu.Dropdown className='context-menu'>
          <DeviceMenuItems device={device} control={control} onStopUsing={onStopUsing} />
        </Menu.Dropdown>
      </Menu>
    </div>
  )
}
