import {Alert, Badge, Group, Stack, Text, Tooltip} from '@mantine/core'
import {IconDeviceMobileCog} from '@tabler/icons-react'
import type {Device} from '@/core/devices/types'
import {gettext, translate, useTranslation} from '@/core/i18n'
import {WidgetCard} from './WidgetCard'

const reasons: Record<string, string> = {
  disconnected: gettext('Connect the iPhone by USB.')
  , trust_required: gettext('Unlock the iPhone and confirm Trust This Computer.')
  , locked: gettext('The iPhone is locked. Open control and use Unlock screen.')
  , developer_mode_required: gettext('Enable Developer Mode in Settings, Privacy & Security on the iPhone.')
  , wda_missing: gettext('Install the signed WebDriverAgent runner.')
  , wda_profile_expired: gettext('The WebDriverAgent profile has expired. Rebuild and reinstall WDA.')
  , wda_profile_expiring: gettext('The WebDriverAgent profile expires soon. Prepare a newly signed WDA.')
  , wda_profile_unknown: gettext('The WebDriverAgent signing profile could not be identified.')
  , tunnel_unavailable: gettext('Waiting for the iPhone USB tunnel.')
  , image_mount_failed: gettext('The iOS developer image could not be mounted.')
  , wda_unavailable: gettext('WebDriverAgent is restarting. Check device unlock and developer trust.')
  , recovering: gettext('Preparing the iPhone...')
  , provider_unavailable: gettext('The iPhone provider is unavailable.')
  , ready: gettext('Ready')
}

export function iosReasonText(reason: string) {
  return translate(reasons[reason] || reasons.recovering!)
}

export function IosHealthBadge({device}: {device: Device}) {
  if (device.platform !== 'iOS' || !device.ios || device.ios.reason === 'ready') {
    return null
  }
  const text = iosReasonText(device.ios.reason)
  return <Tooltip label={text} multiline w={280}>
    <Badge color={device.ready ? 'yellow' : 'red'} variant='light' size='xs' maw='100%'>
      {text}
    </Badge>
  </Tooltip>
}

export function IosDeviceHealth({device}: {device: Device}) {
  const {t} = useTranslation()
  const status = device.ios
  if (!status) {
    return null
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleString() : '—'
  const gb = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GiB`
  let power = t('On battery')
  if (status.battery?.externalPower) {
    power = t('Connected to power')
  }
  if (status.battery?.full) {
    power = t('Full')
  }
  if (status.battery?.charging) {
    power = t('Charging')
  }
  return <WidgetCard title={t('iPhone status')} icon={IconDeviceMobileCog} color='blue'>
    <Stack gap='xs'>
      {status.reason !== 'ready' && <Alert color={device.ready ? 'yellow' : 'red'}>
        {iosReasonText(status.reason)}
      </Alert>}
      <Text size='sm'>{t('Device Name')}: {status.name || '—'}</Text>
      <Group gap='xs'>
        <Text size='sm'>{t('Battery Level')}: {status.battery ? `${status.battery.level}%` : '—'}</Text>
        {status.battery && <Badge variant='light' color={status.battery.externalPower ? 'green' : 'gray'}>
          {power}
        </Badge>}
      </Group>
      <Text size='sm'>{t('Free storage')}: {status.storage ? `${gb(status.storage.free)} / ${gb(status.storage.total)}` : '—'}</Text>
      <Text size='xs' c='dimmed'>{t('Updated')}: {date(status.telemetryAt)}</Text>
      <Text size='sm'>WebDriverAgent: {status.wda.version || '—'}</Text>
      <Text size='sm'>{t('Profile expires')}: {date(status.wda.expiresAt)}</Text>
      {['expiring', 'expired'].includes(status.wda.profile) &&
        status.reason !== 'wda_profile_' + status.wda.profile && <Alert color='yellow'>
          {iosReasonText('wda_profile_' + status.wda.profile)}
        </Alert>}
      {status.wda.profile === 'ambiguous' && <Alert color='yellow'>
        {t('Several WDA profiles match this device. The earliest expiry is shown; verify the installed build.')}
      </Alert>}
      {status.wda.profile !== 'valid' && <Text size='xs' c='dimmed'>
        {t('To renew WDA, rebuild the runner with your Apple Team, reinstall it on this iPhone and confirm developer trust. The Linux provider reconnects automatically.')}
      </Text>}
    </Stack>
  </WidgetCard>
}
