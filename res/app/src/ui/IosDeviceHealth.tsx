import {Alert, Badge, Group, Popover, Stack, Text, Tooltip, VisuallyHidden} from '@mantine/core'
import {IconDeviceMobileCog} from '@tabler/icons-react'
import {useEffect, useId, useState} from 'react'
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

const ambiguousProfile = gettext('Several WDA profiles match this device. The earliest expiry is shown; verify the installed build.')

export function iosReasonText(reason: string) {
  return translate(reasons[reason] || reasons.recovering!)
}

function DiagnosticBadge({text, ready}: {text: string, ready: boolean}) {
  return <Tooltip label={text} multiline w={280}>
    <Badge color={ready ? 'yellow' : 'red'} variant='light' size='xs' maw='100%'>
      {text}
    </Badge>
  </Tooltip>
}

const hourMs = 60 * 60 * 1000

function WdaHealthBadge({expiresAt, reportedExpired}: {
  expiresAt: string | null, reportedExpired: boolean
}) {
  const {t} = useTranslation()
  const [now, setNow] = useState(Date.now)
  const [opened, setOpened] = useState(false)
  const descriptionId = useId()
  const expiry = Date.parse(expiresAt ?? '')
  const remaining = expiry - now
  const expired = reportedExpired || remaining <= 0

  useEffect(() => {
    if (expired || !Number.isFinite(remaining)) {
      return
    }
    const delay = remaining >= hourMs ? remaining % hourMs + 1 : remaining
    const timer = setTimeout(() => setNow(Date.now()), delay)
    return () => clearTimeout(timer)
  }, [expired, remaining])

  let text = t('WDA expiring')
  if (expired) {
    text = t('WDA expired')
  }
  else if (remaining >= hourMs) {
    text = t('WDA · {{hours}}h left', {hours: Math.floor(remaining / hourMs)})
  }
  else if (Number.isFinite(remaining)) {
    text = t('WDA · <1h left')
  }
  const warning = iosReasonText(expired ? 'wda_profile_expired' : 'wda_profile_expiring')
  const localExpiry = Number.isFinite(expiry) ? new Date(expiry).toLocaleString() : null
  const description = localExpiry ? `${warning} ${localExpiry}` : warning
  return <>
    <VisuallyHidden id={descriptionId}>{description}</VisuallyHidden>
    <Popover opened={opened} onChange={setOpened} width='min(280px, calc(100vw - 24px))' shadow='md'>
      <Popover.Target>
        <Badge component='button' type='button' aria-describedby={descriptionId} title={opened ? '' : description}
          color={expired ? 'red' : 'yellow'} variant='light' size='xs' maw='100%' tt='none'
          style={{cursor: 'pointer'}} onClick={() => setOpened((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && opened) {
              event.stopPropagation()
              setOpened(false)
            }
          }}>
          {text}
        </Badge>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={4}>
          <Text size='sm'>{warning}</Text>
          {expiresAt && localExpiry && <Text size='xs' c='dimmed' component='time' dateTime={expiresAt}>
            {localExpiry}
          </Text>}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  </>
}

export function IosHealthBadge({device}: {device: Device}) {
  if (device.platform !== 'iOS' || !device.ios) {
    return null
  }
  let {reason} = device.ios
  if (device.ready && reason === 'locked') {
    const {profile} = device.ios.wda
    reason = profile === 'expiring' || profile === 'expired' ? 'wda_profile_' + profile : 'ready'
  }
  if (reason === 'ready') {
    return null
  }
  if (reason === 'wda_profile_expiring' || reason === 'wda_profile_expired') {
    const {expiresAt} = device.ios.wda
    return <WdaHealthBadge key={expiresAt} expiresAt={expiresAt}
      reportedExpired={reason === 'wda_profile_expired'} />
  }
  return <DiagnosticBadge text={iosReasonText(reason)} ready={device.ready} />
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
        {t(ambiguousProfile)}
      </Alert>}
      {status.wda.profile !== 'valid' && <Text size='xs' c='dimmed'>
        {t('To renew WDA, rebuild the runner with your Apple Team, reinstall it on this iPhone and confirm developer trust. The Linux provider reconnects automatically.')}
      </Text>}
    </Stack>
  </WidgetCard>
}
