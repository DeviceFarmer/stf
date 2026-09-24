import type {ReactElement} from 'react'
import {Menu} from '@mantine/core'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {DeviceMenuItems} from '@/features/control/device-control/DeviceMenuItems'

export function DeviceContextMenu({device, control, onStopUsing, disabled, children}: {
  device: Device
  control: Control
  onStopUsing: () => void
  disabled?: boolean
  children: ReactElement
}) {
  return (
    <Menu shadow='md' width={200} withinPortal>
      <Menu.ContextMenu disabled={disabled}>
        {children}
      </Menu.ContextMenu>
      <Menu.Dropdown className='stf-device-context-menu'>
        <DeviceMenuItems device={device} control={control} onStopUsing={onStopUsing} />
      </Menu.Dropdown>
    </Menu>
  )
}
