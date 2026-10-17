import {useState} from 'react'
import {Alert, Button, Group, Stack, Text} from '@mantine/core'
import {IconDeviceMobileVibration, IconLock, IconLockOpen, IconPower, IconRefresh} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {gettext, useTranslation} from '@/core/i18n'
import {WidgetCard} from '@/ui/WidgetCard'

type PowerAction = 'reboot' | 'shutdown'

export function IosControlsCard({control, device}: {control: Control, device: Device}) {
  const {t} = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockResult, setLockResult] = useState<boolean | null>(null)
  const [confirmPower, setConfirmPower] = useState<PowerAction | null>(null)
  const [powerAccepted, setPowerAccepted] = useState<PowerAction | null>(null)
  const locked = device.ios?.locked === true

  async function screenLock(unlock: boolean) {
    setBusy(true)
    setError(null)
    setLockResult(null)
    try {
      const result = await (unlock ? control.unlock() : control.lock())
      if (unlock && result.body?.locked !== false) {
        setError(gettext('The screen is still locked. Swipe up and enter the passcode on the device screen.'))
      }
      else {
        setLockResult(result.body?.locked === true)
      }
    }
    catch {
      setError(gettext('Could not change the screen lock. Check the iPhone connection and try again.'))
    }
    finally {
      setBusy(false)
    }
  }

  async function shake() {
    setBusy(true)
    setError(null)
    try {
      await control.shake()
    }
    catch {
      setError(gettext('Could not shake the iPhone. Keep it unlocked and use the standard AssistiveTouch menu in English or Russian. Release and reconnect the device if the session ended.'))
    }
    finally {
      setBusy(false)
    }
  }

  async function power(action: PowerAction) {
    setBusy(true)
    setError(null)
    try {
      await control.iosPower(action)
      setConfirmPower(null)
      setPowerAccepted(action)
    }
    catch {
      setError(gettext('The iPhone did not confirm the power command. Check its connection before trying again.'))
    }
    finally {
      setBusy(false)
    }
  }

  return <WidgetCard title={t('iPhone controls')} icon={IconDeviceMobileVibration} color='blue'>
    <Stack gap='sm'>
      <Group grow preventGrowOverflow={false}>
        <Button variant='light' leftSection={<IconLock size={18} />}
          disabled={busy || powerAccepted !== null} onClick={() => screenLock(false)}>
          {t('Lock screen')}
        </Button>
        <Button variant='light' leftSection={<IconLockOpen size={18} />}
          disabled={busy || powerAccepted !== null} onClick={() => screenLock(true)}>
          {t('Unlock screen')}
        </Button>
      </Group>
      <Text size='xs' c='dimmed'>
        {t('The lock screen remains visible while the display is awake. If a passcode is required, enter it on the device screen in STF.')}
      </Text>
      {lockResult !== null && <Text size='xs' c='dimmed'>
        {lockResult ? t('The iPhone is locked.') : t('The iPhone is unlocked.')}
      </Text>}
      <Button variant='light' leftSection={<IconDeviceMobileVibration size={18} />}
        disabled={busy || locked || powerAccepted !== null} onClick={shake}>
        {t('Shake phone')}
      </Button>
      <Text size='xs' c='dimmed'>{t('Triggers the shake gesture used by application debug menus.')}</Text>
      <Group grow preventGrowOverflow={false}>
        <Button variant='light' leftSection={<IconRefresh size={18} />}
          disabled={busy || powerAccepted !== null} onClick={() => setConfirmPower('reboot')}>
          {t('Restart iPhone')}
        </Button>
        <Button variant='light' color='red' leftSection={<IconPower size={18} />}
          disabled={busy || powerAccepted !== null} onClick={() => setConfirmPower('shutdown')}>
          {t('Power off iPhone')}
        </Button>
      </Group>
      {confirmPower && <Alert color={confirmPower === 'shutdown' ? 'red' : 'yellow'}>
        <Stack gap='sm'>
          <Text size='sm'>{confirmPower === 'shutdown' ?
            t('Power off this iPhone? Control will end. Turning it on again requires physical access.') :
            t('Restart this iPhone? Control will end. After startup, iOS may require the first unlock on the phone.')}</Text>
          <Group>
            <Button color={confirmPower === 'shutdown' ? 'red' : 'blue'} loading={busy}
              onClick={() => power(confirmPower)}>{t('Confirm')}</Button>
            <Button variant='subtle' disabled={busy} onClick={() => setConfirmPower(null)}>{t('Cancel')}</Button>
          </Group>
        </Stack>
      </Alert>}
      {powerAccepted && <Alert color='blue'>{powerAccepted === 'shutdown' ?
        t('The iPhone accepted the power-off command.') : t('The iPhone accepted the restart command.')}</Alert>}
      {error && <Alert color='red'>{t(error)}</Alert>}
    </Stack>
  </WidgetCard>
}
