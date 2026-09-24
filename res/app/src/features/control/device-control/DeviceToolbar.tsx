import {ActionIcon, Divider, Group, Menu, Text, Tooltip, UnstyledButton} from '@mantine/core'
import {
  IconChevronDown
  , IconDeviceMobile
  , IconDeviceMobileRotated
  , IconEye
  , IconEyeOff
  , IconRotate
  , IconRotateClockwise
  , IconX
} from '@tabler/icons-react'
import type {Device} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import type {DeviceActions} from './use-device-actions'
import classes from './DeviceControlPanel.module.css'

function DeviceNameMenu({device, actions}: {device: Device, actions: DeviceActions}) {
  const {groupDevices} = actions
  const hasGroup = groupDevices.length > 0

  return (
    <Menu position='bottom-start' width={280} shadow='md' disabled={!hasGroup} withinPortal>
      <Menu.Target>
        <UnstyledButton className={`${classes.deviceName} stf-vnc-device-name unselectable`}>
          <img className={classes.deviceImage} src={device.enhancedImage24} alt='' />
          <Text size='sm' fw={600} truncate className='device-name-text'>{device.enhancedName}</Text>
          {hasGroup && <IconChevronDown size={14} className='caret' />}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {groupDevices.map((groupDevice) => (
          <Menu.Item
            key={groupDevice.serial}
            className='device-name-menu-element'
            leftSection={<img className={classes.menuDeviceImage} src={groupDevice.enhancedImage24} alt='' />}
            rightSection={(
              <ActionIcon
                component='span'
                size='sm'
                variant='subtle'
                color='gray'
                className={`${classes.kickDevice} kick-device`}
                onClick={(event) => {
                  event.stopPropagation()
                  actions.stopUsing(groupDevice)
                }}
              >
                <IconX size={14} />
              </ActionIcon>
            )}
            onClick={() => actions.controlDevice(groupDevice)}
          >
            <Text
              size='sm'
              fw={groupDevice.serial === device.serial ? 700 : 400}
              className={groupDevice.serial === device.serial ? 'current-device' : undefined}
              truncate
            >
              {groupDevice.enhancedName}
            </Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

export function DeviceToolbar({device, actions, showScreen, onToggleScreen}: {
  device: Device
  actions: DeviceActions
  showScreen: boolean
  onToggleScreen: () => void
}) {
  const {t} = useTranslation()
  const rotationSuffix = `(${t('Current rotation:')} ${actions.rotation}°)`

  return (
    <div className={`${classes.toolbar} stf-vnc-navbar`}>
      <DeviceNameMenu device={device} actions={actions} />
      <Group gap={6} wrap='nowrap' className={`${classes.rightButtons} stf-vnc-right-buttons`}>
        <ActionIcon.Group>
          <Tooltip label={`${t('Portrait')} ${rotationSuffix}`} position='bottom'>
            <ActionIcon
              size='md'
              variant={actions.currentRotation === 'portrait' ? 'filled' : 'default'}
              aria-label={t('Portrait')}
              aria-pressed={actions.currentRotation === 'portrait'}
              onClick={() => actions.tryToRotate('portrait')}
            >
              <IconDeviceMobile size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={`${t('Landscape')} ${rotationSuffix}`} position='bottom'>
            <ActionIcon
              size='md'
              variant={actions.currentRotation === 'landscape' ? 'filled' : 'default'}
              aria-label={t('Landscape')}
              aria-pressed={actions.currentRotation === 'landscape'}
              onClick={() => actions.tryToRotate('landscape')}
            >
              <IconDeviceMobileRotated size={16} />
            </ActionIcon>
          </Tooltip>
        </ActionIcon.Group>
        <ActionIcon.Group>
          <Tooltip label={t('Rotate Left')} position='bottom'>
            <ActionIcon
              size='md'
              variant='default'
              aria-label={t('Rotate Left')}
              onClick={() => actions.rotateBy(90)}
            >
              <IconRotate size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('Rotate Right')} position='bottom'>
            <ActionIcon
              size='md'
              variant='default'
              aria-label={t('Rotate Right')}
              onClick={() => actions.rotateBy(-90)}
            >
              <IconRotateClockwise size={16} />
            </ActionIcon>
          </Tooltip>
        </ActionIcon.Group>
        <Divider orientation='vertical' />
        <Tooltip label={showScreen ? t('Hide Screen') : t('Show Screen')} position='bottom'>
          <ActionIcon
            size='md'
            variant={showScreen ? 'light' : 'filled'}
            color='cyan'
            aria-label={showScreen ? t('Hide Screen') : t('Show Screen')}
            aria-pressed={!showScreen}
            onClick={onToggleScreen}
          >
            {showScreen ? <IconEye size={16} /> : <IconEyeOff size={16} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('Stop Using')} position='bottom'>
          <ActionIcon
            size='md'
            variant='light'
            color='red'
            className='stop-using btn-danger-outline'
            aria-label={t('Stop Using')}
            onClick={(event) => {
              event.stopPropagation()
              actions.stopUsing(device)
            }}
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </div>
  )
}
