import {Button, Group} from '@mantine/core'
import {IconRefresh, IconTool} from '@tabler/icons-react'
import {gettext, translate, useTranslation} from '@/core/i18n'
import {openConfirm, withErrorModal} from '@/ui/modals'
import {WidgetCard} from '@/ui/WidgetCard'
import type {PaneProps} from '../../types'

async function confirmReboot(question: string, reboot: () => Promise<unknown>) {
  const confirmed = await openConfirm({
    title: translate(question)
    , message: translate('The device will be unavailable for a moment.')
    , danger: true
  })
  if (confirmed) {
    await withErrorModal(reboot)
  }
}

export function MaintenanceCard({control}: Pick<PaneProps, 'control'>) {
  const {t} = useTranslation()

  return (
    <WidgetCard title={t('Maintenance')} icon={IconTool} color='gray' className='stf-maintenance'>
      <Group gap='sm'>
        <Button
          variant='filled'
          color='red'
          leftSection={<IconRefresh size={16} />}
          className='stf-restart-device'
          onClick={() => confirmReboot(
            gettext('Are you sure you want to reboot this device?')
            , () => control.reboot()
          )}
        >
          {t('Restart Device')}
        </Button>
        <Button
          variant='filled'
          color='yellow'
          leftSection={<IconRefresh size={16} />}
          className='stf-restart-keep-device'
          onClick={() => confirmReboot(
            gettext('Are you sure you want to reboot this device and keep using it afterwards?')
            , () => control.rebootAndKeep()
          )}
        >
          {t('Restart and Keep Device')}
        </Button>
      </Group>
    </WidgetCard>
  )
}
