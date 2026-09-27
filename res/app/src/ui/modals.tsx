import type {ComponentType} from 'react'
import {Button, Code, Group, Stack, Text, ThemeIcon} from '@mantine/core'
import {modals} from '@mantine/modals'
import {
  IconAlertTriangle
  , IconCircleX
  , IconInfoCircle
  , IconKey
  , IconPlugConnectedX
  , IconRefresh
} from '@tabler/icons-react'
import {ApiError} from '@/core/api'
import {translate} from '@/core/i18n'

export type GenericModalType = 'Warning' | 'Information' | 'Error'

const typeIcons = {
  Warning: {icon: IconAlertTriangle, color: 'yellow'}
  , Information: {icon: IconInfoCircle, color: 'blue'}
  , Error: {icon: IconCircleX, color: 'red'}
}

export function ModalTitle({icon: Icon, color, title}: {
  icon: ComponentType<{size?: number}>
  color?: string
  title: string
}) {
  return (
    <Group gap='sm'>
      <ThemeIcon variant='light' {...(color === undefined ? {} : {color})} radius='xl'>
        <Icon size={18} />
      </ThemeIcon>
      <Text fw={600}>{title}</Text>
    </Group>
  )
}

export function openGenericModal(options: {
  type: GenericModalType
  message: string
  title?: string
  cancel?: boolean
  size?: string
}): Promise<boolean> {
  return new Promise((resolve) => {
    const id = modals.open({
      title: <ModalTitle {...typeIcons[options.type]} title={options.title || translate(options.type)} />
      , size: options.size === 'lg' ? 'lg' : 'md'
      , centered: true
      , onClose: () => resolve(false)
      , children: (
        <Stack>
          <Text>{translate(options.message)}</Text>
          <Group justify='flex-end'>
            {options.cancel && (
              <Button variant='default' onClick={() => modals.close(id)}>
                {translate('Cancel')}
              </Button>
            )}
            <Button
              variant='filled'
              onClick={() => {
                resolve(true)
                modals.close(id)
              }}
            >
              {translate('OK')}
            </Button>
          </Group>
        </Stack>
      )
    })
  })
}

export function openConfirm(options: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    modals.openConfirmModal({
      title: options.title
      , centered: true
      , children: <Text size='sm'>{options.message}</Text>
      , labels: {
        confirm: options.confirmLabel || translate('OK')
        , cancel: translate('Cancel')
      }
      , confirmProps: {...(options.danger ? {color: 'red'} : {}), variant: 'filled'}
      , onConfirm: () => resolve(true)
      , onCancel: () => resolve(false)
      , onClose: () => resolve(false)
    })
  })
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.data?.description || `${error.status} ${error.statusText}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export async function withErrorModal<T>(action: () => Promise<T>): Promise<{value?: T, error?: unknown}> {
  try {
    return {value: await action()}
  }
  catch (error) {
    await openGenericModal({type: 'Error', message: errorMessage(error), size: 'lg'})
    return {error}
  }
}

let disconnectedOpen = false

export function openSocketDisconnected(message: string): void {
  if (disconnectedOpen) {
    return
  }
  disconnectedOpen = true
  modals.open({
    title: <ModalTitle icon={IconPlugConnectedX} color='red' title={translate('Disconnected')} />
    , centered: true
    , onClose: () => {
      disconnectedOpen = false
    }
    , children: (
      <Stack>
        <Text c='dimmed'>{translate(message)}</Text>
        <Group justify='flex-end'>
          <Button
            variant='filled'
            leftSection={<IconRefresh size={16} />}
            onClick={() => window.location.reload()}
          >
            {translate('Try to reconnect')}
          </Button>
        </Group>
      </Stack>
    )
  })
}

export function openVersionUpdate(): void {
  modals.open({
    title: <ModalTitle {...typeIcons.Information} title={translate('Version Update')} />
    , centered: true
    , children: (
      <Stack>
        <Text>{translate('A new version of STF is available')}</Text>
        <Group justify='flex-end'>
          <Button
            variant='filled'
            leftSection={<IconRefresh size={16} />}
            onClick={() => {
              window.location.hash = '#/'
              window.location.reload()
            }}
          >
            {translate('Reload')}
          </Button>
        </Group>
      </Stack>
    )
  })
}

export function openAddAdbKey(data: {fingerprint: string, title: string}): Promise<boolean> {
  return new Promise((resolve) => {
    const id = modals.open({
      title: <ModalTitle icon={IconKey} title={translate('Add the following ADB Key to STF?')} />
      , centered: true
      , size: 'lg'
      , onClose: () => resolve(false)
      , children: (
        <Stack className='stf-add-adb-key-modal'>
          <div>
            <Text size='sm' fw={500} mb={4}>{translate('Fingerprint')}</Text>
            <Code block>{data.fingerprint}</Code>
          </div>
          <div>
            <Text size='sm' fw={500} mb={4}>{translate('Device')}</Text>
            <Code block>{data.title}</Code>
          </div>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => modals.close(id)}>
              {translate('Cancel')}
            </Button>
            <Button
              variant='filled'
              onClick={() => {
                resolve(true)
                modals.close(id)
              }}
            >
              {translate('Add Key')}
            </Button>
          </Group>
        </Stack>
      )
    })
  })
}
