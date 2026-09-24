import {memo, useMemo, useState, type MouseEvent} from 'react'
import {Group, Loader, Text} from '@mantine/core'
import {IconBattery2, IconUser} from '@tabler/icons-react'
import {createControl} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {controlHref, type DeviceActions} from './device-actions'
import {StatusButton} from './cells'
import {DeviceContextMenu} from './DeviceContextMenu'
import classes from './DeviceList.module.css'

function TileMeta({device}: {device: Device}) {
  const battery = device.battery ? Math.floor(device.battery.level / device.battery.scale * 100) : null
  return (
    <Group gap={4} justify='center' wrap='wrap' className={classes.tileMeta}>
      {device.version && (
        <span className={classes.chip} title={device.sdk ? `SDK ${device.sdk}` : undefined}>
          {device.platform ? `${device.platform} ${device.version}` : device.version}
        </span>
      )}
      {battery !== null && (
        <span className={classes.chip}>
          <IconBattery2 size={12} />
          {battery}%
        </span>
      )}
    </Group>
  )
}

const DeviceTile = memo(function DeviceTile({device, actions}: {
  device: Device
  actions: DeviceActions
}) {
  const [pending, setPending] = useState(false)
  const control = useMemo(() => (device.using ? createControl(device, device.channel) : null), [device])

  function open(event: MouseEvent) {
    const result = actions.open(event, device)
    if (result) {
      setPending(true)
      result.finally(() => setPending(false))
    }
  }

  const content = (
    <>
      <div className={`device-photo-small ${classes.photo}`}>
        <img src={device.enhancedImage120} alt='' loading='lazy' />
      </div>
      <div className={`device-name ${device.state === 'available' ? 'state-available' : ''} ${classes.name}`}>
        {device.enhancedName}
      </div>
      <Text size='xs' c='dimmed' truncate className={classes.model}>
        {device.enhancedModel}
      </Text>
      <TileMeta device={device} />
    </>
  )

  const tileClasses = [
    classes.tile
    , device.usable ? '' : `device-is-busy ${classes.unusable}`
    , device.using ? classes.using : ''
  ].join(' ')

  const tile = (
    <li className={tileClasses} title={device.provider?.name}>
      {device.usable ?
        <a href={controlHref(device)} className={classes.tileLink} onClick={open}>
          {content}
        </a> :
        <div className={classes.tileLink}>{content}</div>}
      <div className={classes.tileFooter}>
        <StatusButton device={device} actions={actions} />
        {device.owner && (
          <Group gap={4} wrap='nowrap' className={classes.owner}>
            <IconUser size={12} />
            <Text size='xs' truncate>{device.owner.name || device.owner.email}</Text>
          </Group>
        )}
      </div>
      {pending && (
        <div className={classes.pending}>
          <Loader size='sm' />
        </div>
      )}
    </li>
  )

  if (!control) {
    return tile
  }

  return (
    <DeviceContextMenu device={device} control={control} onStopUsing={() => actions.stop(device)}>
      {tile}
    </DeviceContextMenu>
  )
})

export function DeviceIconsView({devices, actions}: {devices: Device[], actions: DeviceActions}) {
  return (
    <ul className={`devices-icon-view ${classes.grid}`}>
      {devices.map((device) => <DeviceTile key={device.serial} device={device} actions={actions} />)}
    </ul>
  )
}
