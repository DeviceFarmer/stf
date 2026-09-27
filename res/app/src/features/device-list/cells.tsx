import {memo, useState} from 'react'
import {ActionIcon, Anchor, Button, Group, TextInput} from '@mantine/core'
import {IconCheck, IconPencil, IconX} from '@tabler/icons-react'
import {statusNameAction} from '@/core/devices/enhance'
import {updateDeviceNote} from '@/core/devices/store'
import type {Device, DeviceBrowserApp} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {stateClass, stateColor} from '@/ui/device-state'
import {canStartUsing, controlHref, type DeviceActions} from './device-actions'
import classes from './DeviceList.module.css'

export function canShowPhoto(device: Device): boolean {
  return Boolean(device.name && device.image)
}

export const StatusButton = memo(function StatusButton({device, actions}: {
  device: Device
  actions: DeviceActions
}) {
  const [pending, setPending] = useState(false)
  const actionable = Boolean(device.usable) || (actions.adminMode && device.state === 'busy')

  return (
    <Button
      size='compact-xs'
      radius='xl'
      color={stateColor(device.state)}
      variant={device.using ? 'filled' : 'light'}
      className={`device-status ${stateClass(device.state)} ${actionable ? '' : classes.inert}`}
      loading={pending}
      onClick={(event) => {
        const result = actions.status(event, device)
        if (result) {
          setPending(true)
          result.finally(() => setPending(false))
        }
      }}
    >
      {statusNameAction(device.state)}
    </Button>
  )
})

export function NameLink({device, label, actions, userEmail}: {
  device: Device
  label: string
  actions: DeviceActions
  userEmail: string
}) {
  const mine = Boolean(device.using && device.owner?.email === userEmail)
  if (!mine && !canStartUsing(device)) {
    return <span className='device-product-name-unusable'>{label}</span>
  }
  return (
    <Anchor
      href={controlHref(device)}
      size='sm'
      className={mine ? 'device-product-name-using' : 'device-product-name-usable'}
      fw={mine ? 600 : undefined}
      onClick={(event) => actions.open(event, device)}
    >
      {label}
    </Anchor>
  )
}

export function ModelCell({device, label, onImage}: {
  device: Device
  label: string
  onImage: (device: Device) => void
}) {
  const zoomable = canShowPhoto(device)
  return (
    <Group gap={8} wrap='nowrap'>
      <span className='device-small-image'>
        <img
          src={device.enhancedImage24}
          alt=''
          loading='lazy'
          className={`device-small-image-img ${classes.smallImage} ${zoomable ? classes.zoomable : ''}`}
          onClick={zoomable ? () => onImage(device) : undefined}
        />
      </span>
      <span>{label}</span>
    </Group>
  )
}

export function BrowserIcons({apps}: {apps: DeviceBrowserApp[]}) {
  const sorted = apps.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return (
    <span className={`device-browser-list ${classes.browsers}`}>
      {sorted.map((app) => (
        <img
          key={app.id}
          src={`/static/app/browsers/icon/36x36/${app.type || '_default'}.png`}
          title={`${app.name} (${app.developer})`}
          alt={app.name}
        />
      ))}
    </span>
  )
}

export function ExternalLink({label, href}: {label: string, href?: string | undefined}) {
  if (!href) {
    return <>{label}</>
  }
  return (
    <Anchor href={href} target='_blank' rel='noreferrer' size='sm'>
      {label}
    </Anchor>
  )
}

export function NoteCell({device}: {device: Device}) {
  const {t} = useTranslation()
  const [draft, setDraft] = useState<string | null>(null)

  function save(note: string) {
    updateDeviceNote(device.serial, note)
    setDraft(null)
  }

  if (draft !== null) {
    return (
      <Group gap={4} wrap='nowrap'>
        <TextInput
          size='xs'
          autoFocus
          value={draft}
          aria-label={t('Notes')}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              save(draft)
            }
            else if (event.key === 'Escape') {
              setDraft(null)
            }
          }}
        />
        <ActionIcon size='sm' variant='light' color='green' onClick={() => save(draft)} aria-label={t('Save')}>
          <IconCheck size={14} />
        </ActionIcon>
        <ActionIcon size='sm' variant='light' color='gray' onClick={() => setDraft(null)} aria-label={t('Cancel')}>
          <IconX size={14} />
        </ActionIcon>
      </Group>
    )
  }

  return (
    <Group gap={6} wrap='nowrap' className={`device-note ${classes.note}`}>
      <span>{device.notes || ''}</span>
      <ActionIcon
        size='xs'
        variant='subtle'
        color='gray'
        className={`device-note-edit ${classes.noteEdit}`}
        onClick={() => setDraft(device.notes || '')}
        aria-label={t('Notes')}
      >
        <IconPencil size={12} />
      </ActionIcon>
    </Group>
  )
}
