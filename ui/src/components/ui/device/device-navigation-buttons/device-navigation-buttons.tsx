import { Flex } from '@vkontakte/vkui'
import { Icon24SquareOutline, Icon28ArrowUturnLeftOutline, Icon28HomeOutline, Icon28Menu } from '@vkontakte/icons'
import { useTranslation } from 'react-i18next'
import { observer } from 'mobx-react-lite'

import { ConditionalRender } from '@/components/lib/conditional-render'

import { useServiceLocator } from '@/lib/hooks/use-service-locator.hook'
import { DeviceControlStore } from '@/store/device-control-store'
import { deviceBySerialStore } from '@/store/device-by-serial-store'
import { useDeviceSerial } from '@/lib/hooks/use-device-serial.hook'

import { NavigationButton } from './navigation-button'

import styles from './device-navigation-buttons.module.css'

export const DeviceNavigationButtons = observer(() => {
  const { t } = useTranslation()
  const serial = useDeviceSerial()
  const deviceControlStore = useServiceLocator<DeviceControlStore>(DeviceControlStore.name)

  const { data: device } = deviceBySerialStore.deviceQueryResult(serial)

  return (
    <Flex align='center' className={styles.deviceNavigationButtons} justify='space-around'>
      <ConditionalRender conditions={[!!device?.ios]}>
        <NavigationButton
          beforeIcon={<Icon24SquareOutline />}
          title={`${t('Home')}`}
          onClick={() => {
            deviceControlStore?.home()
          }}
        />
      </ConditionalRender>
      <ConditionalRender conditions={[!device?.ios]}>
        <NavigationButton
          beforeIcon={<Icon28Menu />}
          title={`${t('Menu')}`}
          onClick={() => {
            deviceControlStore?.menu()
          }}
        />
        <NavigationButton
          beforeIcon={<Icon28HomeOutline />}
          title={`${t('Home')}`}
          onClick={() => {
            deviceControlStore?.home()
          }}
        />
        <NavigationButton
          beforeIcon={<Icon24SquareOutline height={28} width={28} />}
          title={`${t('App switch')}`}
          onClick={() => {
            deviceControlStore?.appSwitch()
          }}
        />
        <NavigationButton
          beforeIcon={<Icon28ArrowUturnLeftOutline />}
          title={`${t('Back')}`}
          onClick={() => {
            deviceControlStore?.back()
          }}
        />
      </ConditionalRender>
    </Flex>
  )
})
