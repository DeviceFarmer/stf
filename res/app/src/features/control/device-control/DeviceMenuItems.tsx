import {Menu} from '@mantine/core'
import {
  IconArrowBackUp
  , IconCamera
  , IconHome
  , IconLogout
  , IconRotate
  , IconRotateClockwise
  , IconSquare
} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {useStandalone} from '@/ui/modes'
import {rotateBy, rotationOf, saveScreenshot} from './device-commands'
import type {DeviceActions} from './use-device-actions'

export function DeviceMenuItems({device, control, onStopUsing, rotationActions}: {
  device: Device
  control: Control
  onStopUsing: () => void
  rotationActions?: Pick<DeviceActions, 'rotateBy' | 'rotationDisabled'>
}) {
  const {t} = useTranslation()
  const standalone = useStandalone()
  const ios = device.platform === 'iOS'
  const rotationDisabled = control.readOnly || rotationActions?.rotationDisabled === true
  const rotate = rotationActions?.rotateBy ??
    ((delta: number) => rotateBy(control, rotationOf(device), delta, standalone))

  return (
    <>
      {!ios && <Menu.Item disabled={control.readOnly}
        leftSection={<IconArrowBackUp size={16} />} onClick={() => control.back()}>
        {t('Back')}
      </Menu.Item>}
      <Menu.Item disabled={control.readOnly}
        leftSection={<IconHome size={16} />} onClick={() => control.home()}>
        {t('Home')}
      </Menu.Item>
      {!ios && <>
      <Menu.Item disabled={control.readOnly}
        leftSection={<IconSquare size={16} />} onClick={() => control.appSwitch()}>
        {t('Recents')}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item disabled={rotationDisabled}
        leftSection={<IconRotate size={16} />} onClick={() => rotate(90)}>
        {t('Rotate Left')}
      </Menu.Item>
      <Menu.Item
        disabled={rotationDisabled}
        leftSection={<IconRotateClockwise size={16} />}
        onClick={() => rotate(-90)}
      >
        {t('Rotate Right')}
      </Menu.Item>
      <Menu.Divider />
      </>}
      <Menu.Item disabled={control.readOnly}
        leftSection={<IconCamera size={16} />} onClick={() => saveScreenshot(control)}>
        {t('Save ScreenShot')}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item
        disabled={control.readOnly}
        color='red'
        leftSection={<IconLogout size={16} />}
        onClick={() => (standalone ? window.close() : onStopUsing())}
      >
        {t('Stop Using')}
      </Menu.Item>
    </>
  )
}
