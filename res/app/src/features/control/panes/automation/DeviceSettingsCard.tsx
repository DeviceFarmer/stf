import {useState, type ReactNode} from 'react'
import {
  ActionIcon
  , Center
  , Group
  , Loader
  , SegmentedControl
  , Stack
  , Switch
  , Text
  , Tooltip
} from '@mantine/core'
import {useTimeout} from '@mantine/hooks'
import {
  IconBluetooth
  , IconDeviceMobileVibration
  , IconSettings
  , IconTrash
  , IconVolume
  , IconVolume3
  , IconWifi
} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import {gettext, translate, useTranslation} from '@/core/i18n'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import type {PaneProps} from '../../types'
import {useDeviceValue} from '../use-device-value'
import classes from './AutomationPane.module.css'

const ringerModes = [
  {value: 'SILENT', label: gettext('Silent Mode'), icon: IconVolume3}
  , {value: 'VIBRATE', label: gettext('Vibrate Mode'), icon: IconDeviceMobileVibration}
  , {value: 'NORMAL', label: gettext('Normal Mode'), icon: IconVolume}
]

const readWifi = (control: Control) =>
  control.getWifiStatus().then((result) => result.lastData === 'wifi_enabled')
const readBluetooth = (control: Control) =>
  control.getBluetoothStatus().then((result) => result.lastData === 'bluetooth_enabled')
const readRingerMode = (control: Control) =>
  control.getRingerMode().then((result) => String(result.body))

function notifyError(error: unknown) {
  notifyFailure(error, translate('Device Settings'))
}

function SettingRow({icon, label, children}: {icon: ReactNode, label: string, children: ReactNode}) {
  return (
    <Group justify='space-between' wrap='wrap' gap='sm' className={classes.settingRow}>
      <Group gap='sm' wrap='nowrap'>
        {icon}
        <Text size='sm' fw={500}>{label}</Text>
      </Group>
      <Group gap='sm' wrap='nowrap'>{children}</Group>
    </Group>
  )
}

function StatusLoader() {
  return <Center w={42} h={24}><Loader size='xs' /></Center>
}

export function DeviceSettingsCard({control}: Pick<PaneProps, 'control'>) {
  const {t} = useTranslation()
  const wifi = useDeviceValue(control, readWifi)
  const bluetooth = useDeviceValue(control, readBluetooth)
  const ringer = useDeviceValue(control, readRingerMode)
  const [bluetoothPending, setBluetoothPending] = useState(false)
  const wifiRecheck = useTimeout(wifi.reload, 2500)

  function toggleWifi(enable: boolean) {
    wifi.setValue(enable)
    control.setWifiEnabled(enable).catch(notifyError)
    wifiRecheck.clear()
    wifiRecheck.start()
  }

  function toggleBluetooth(enable: boolean) {
    setBluetoothPending(true)
    control.setBluetoothEnabled(enable)
      .then(() => {
        if (bluetooth.active.current) {
          bluetooth.setValue(enable)
        }
      })
      .catch(notifyError)
      .finally(() => {
        if (bluetooth.active.current) {
          setBluetoothPending(false)
        }
      })
  }

  function changeRingerMode(mode: string) {
    ringer.setValue(mode)
    control.setRingerMode(mode).catch(notifyError)
  }

  return (
    <WidgetCard title={t('Device Settings')} icon={IconSettings} color='gray' className='stf-device-settings'>
      <Stack gap={0}>
        <SettingRow icon={<IconVolume size={18} />} label={t('Manner Mode')}>
          {ringer.loading && ringer.value === null ?
            <StatusLoader /> :
            <SegmentedControl
              size='xs'
              value={ringer.value || ''}
              onChange={changeRingerMode}
              className='stf-ringer-mode'
              data={ringerModes.map(({value, label, icon: Icon}) => ({
                value
                , label: (
                  <Tooltip label={t(label)}>
                    <Center className={classes.segment} aria-label={t(label)}>
                      <Icon size={16} />
                    </Center>
                  </Tooltip>
                )
              }))}
            />}
        </SettingRow>

        <SettingRow icon={<IconWifi size={18} />} label={t('WiFi')}>
          {wifi.loading && wifi.value === null ?
            <StatusLoader /> :
            <Tooltip label={wifi.value ? t('Disable WiFi') : t('Enable WiFi')}>
              <div>
                <Switch
                  size='md'
                  checked={Boolean(wifi.value)}
                  onChange={(event) => toggleWifi(event.currentTarget.checked)}
                  className='stf-wifi-switch'
                  aria-label={t('WiFi')}
                />
              </div>
            </Tooltip>}
        </SettingRow>

        <SettingRow icon={<IconBluetooth size={18} />} label={t('Bluetooth')}>
          <Tooltip label={t('Clean Bluetooth bonded devices')}>
            <ActionIcon
              variant='subtle'
              color='red'
              onClick={() => control.cleanBluetoothBondedDevices().catch(notifyError)}
              aria-label={t('Clean Bluetooth bonded devices')}
              className='stf-clean-bluetooth-bonds'
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
          {bluetooth.loading && bluetooth.value === null ?
            <StatusLoader /> :
            <Tooltip label={bluetooth.value ? t('Disable Bluetooth') : t('Enable Bluetooth')}>
              <div>
                <Switch
                  size='md'
                  checked={Boolean(bluetooth.value)}
                  disabled={bluetoothPending || bluetooth.loading}
                  onChange={(event) => toggleBluetooth(event.currentTarget.checked)}
                  className='stf-bluetooth-switch'
                  aria-label={t('Bluetooth')}
                />
              </div>
            </Tooltip>}
        </SettingRow>
      </Stack>
    </WidgetCard>
  )
}
