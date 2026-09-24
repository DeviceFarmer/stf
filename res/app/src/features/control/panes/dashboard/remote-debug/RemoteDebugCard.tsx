import {useEffect, useEffectEvent, useState} from 'react'
import {Alert, Button, Loader, Text, TextInput} from '@mantine/core'
import {IconAlertTriangle, IconBug, IconPlayerPlay, IconPlayerStop} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import {createDeviceStore} from '@/core/device-store'
import type {Device} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {CopyButton} from '@/ui/CopyButton'
import {errorMessage} from '@/ui/modals'
import {usePlatform} from '@/ui/modes'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import classes from '../Dashboard.module.css'

const remoteDebugStore = createDeviceStore<{url: string | null, stoppedControl: Control | null}>({
  url: null
  , stoppedControl: null
})

export function RemoteDebugCard({device, control}: {device: Device, control: Control}) {
  const {t} = useTranslation()
  const [platform] = usePlatform()
  const serial = device.serial
  const state = remoteDebugStore.useValue(serial)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stopped = state.stoppedControl === control
  const url: string | null = stopped ? null : state.url ?? device.remoteConnectUrl ?? null
  const debugCommand = url ? `adb connect ${url}` : ''
  const hint = platform === 'native' ?
    t('Run the following on your command line to debug the device from your IDE') :
    t('Run the following on your command line to debug the device from your Browser')

  function start() {
    setStarting(true)
    setError(null)
    control.startRemoteConnect()
      .then((result) => remoteDebugStore.set(serial, {url: result.lastData, stoppedControl: null}))
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setStarting(false))
  }

  function stop() {
    setStopping(true)
    control.stopRemoteConnect()
      .then(() => remoteDebugStore.set(serial, {url: null, stoppedControl: control}))
      .catch(notifyFailure)
      .finally(() => setStopping(false))
  }

  const startUnlessStoppedBy = useEffectEvent((target: Control) => {
    if (remoteDebugStore.get(serial).stoppedControl !== target) {
      start()
    }
  })

  useEffect(() => {
    startUnlessStoppedBy(control)
  }, [control])

  return (
    <WidgetCard
      className='stf-remote-debug'
      icon={IconBug}
      color='green'
      title={t('Remote debug')}
      help={{topic: 'Remote-Debug', tooltip: hint}}
      actions={url ?
        (
          <Button
            size='compact-xs'
            color='red'
            variant='subtle'
            leftSection={<IconPlayerStop size={14} />}
            loading={stopping}
            onClick={stop}
          >
            {t('Stop')}
          </Button>
        ) :
        (
          <Button
            size='compact-xs'
            variant='subtle'
            leftSection={<IconPlayerPlay size={14} />}
            loading={starting}
            onClick={start}
          >
            {t('Start')}
          </Button>
        )}
    >
      <TextInput
        readOnly
        value={debugCommand}
        placeholder='adb connect ...'
        classNames={{input: `remote-debug-textarea ${classes.monoInput}`}}
        onFocus={(event) => event.currentTarget.select()}
        leftSection={starting && !url ? <Loader size='xs' /> : undefined}
        rightSection={<CopyButton value={debugCommand} />}
        rightSectionWidth={40}
      />
      {error && (
        <Alert mt='sm' color='red' variant='light' icon={<IconAlertTriangle size={18} />} title={t('Oops!')}>
          {error}
        </Alert>
      )}
      <Text size='xs' c='dimmed' mt='xs'>{hint}</Text>
    </WidgetCard>
  )
}
