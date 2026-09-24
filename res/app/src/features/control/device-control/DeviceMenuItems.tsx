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
import {rotateBy, saveScreenshot} from './device-commands'

export function DeviceMenuItems({device, control, onStopUsing}: {
  device: Device
  control: Control
  onStopUsing: () => void
}) {
  const {t} = useTranslation()
  const standalone = useStandalone()

  return (
    <>
      <Menu.Item leftSection={<IconArrowBackUp size={16} />} onClick={() => control.back()}>
        {t('Back')}
      </Menu.Item>
      <Menu.Item leftSection={<IconHome size={16} />} onClick={() => control.home()}>
        {t('Home')}
      </Menu.Item>
      <Menu.Item leftSection={<IconSquare size={16} />} onClick={() => control.appSwitch()}>
        {t('Recents')}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item leftSection={<IconRotate size={16} />} onClick={() => rotateBy(control, device, 90, standalone)}>
        {t('Rotate Left')}
      </Menu.Item>
      <Menu.Item
        leftSection={<IconRotateClockwise size={16} />}
        onClick={() => rotateBy(control, device, -90, standalone)}
      >
        {t('Rotate Right')}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item leftSection={<IconCamera size={16} />} onClick={() => saveScreenshot(control)}>
        {t('Save ScreenShot')}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item
        color='red'
        leftSection={<IconLogout size={16} />}
        onClick={() => (standalone ? window.close() : onStopUsing())}
      >
        {t('Stop Using')}
      </Menu.Item>
    </>
  )
}
