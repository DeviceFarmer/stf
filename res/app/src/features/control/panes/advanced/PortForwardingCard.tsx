import {useEffect} from 'react'
import {ActionIcon, Checkbox, Group, Loader, Table, Text, TextInput, Tooltip} from '@mantine/core'
import {
  IconArrowRight
  , IconArrowsShuffle
  , IconDeviceLaptop
  , IconDeviceMobile
  , IconPlus
  , IconTrash
} from '@tabler/icons-react'
import {translate, useTranslation} from '@/core/i18n'
import {NothingToShow} from '@/ui/NothingToShow'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import type {PaneProps} from '../../types'
import {
  addForwardRow
  , forwardRowsStore
  , removeForwardRow
  , syncForwardRows
  , updateForwardRow
  , type ForwardRow
} from './portForwardsStore'
import classes from './AdvancedPane.module.css'

function notifyError(error: unknown) {
  notifyFailure(error, translate('Port Forwarding'))
}

export function PortForwardingCard({device, control}: PaneProps) {
  const {t} = useTranslation()
  const serial = device.serial
  const rows = forwardRowsStore.useValue(serial)
  const signature = JSON.stringify(device.reverseForwards || [])

  useEffect(() => {
    syncForwardRows(serial, JSON.parse(signature))
  }, [serial, signature])

  function applyForward(row: ForwardRow, enabled: boolean) {
    updateForwardRow(serial, row.id, {enabled, pending: true})
    const request = enabled ? control.createForward(row) : control.removeForward(row)
    request
      .then(() => updateForwardRow(serial, row.id, {pending: false}))
      .catch((error) => {
        updateForwardRow(serial, row.id, {enabled: !enabled, pending: false})
        notifyError(error)
      })
  }

  function removeRow(row: ForwardRow) {
    if (row.enabled) {
      control.removeForward(row).catch(notifyError)
    }
    removeForwardRow(serial, row.id)
  }

  function field(row: ForwardRow, name: 'devicePort' | 'targetHost' | 'targetPort', placeholder: string) {
    return (
      <TextInput
        size='xs'
        value={row[name]}
        disabled={row.enabled || row.pending}
        placeholder={placeholder}
        onChange={(event) => updateForwardRow(serial, row.id, {[name]: event.currentTarget.value})}
        autoComplete='off'
        name={name}
        leftSectionPointerEvents='all'
        leftSection={name === 'devicePort' && (row.pending ?
          <Loader size={14} /> :
          <Checkbox
            size='xs'
            checked={row.enabled}
            onChange={(event) => applyForward(row, event.currentTarget.checked)}
            aria-label={t('Port Forwarding')}
          />)}
      />
    )
  }

  return (
    <WidgetCard
      title={t('Port Forwarding')}
      icon={IconArrowsShuffle}
      color='orange'
      className='stf-port-forwarding'
      actions={(
        <ActionIcon variant='light' onClick={() => addForwardRow(serial)} className='stf-add-forward'>
          <IconPlus size={16} />
        </ActionIcon>
      )}
    >
      {rows.length === 0 ?
        <NothingToShow message={t('No Ports Forwarded')} icon={<IconArrowsShuffle size={30} />} /> :
        <form name='portsform' onSubmit={(event) => event.preventDefault()}>
          <Group justify='center' gap='xs' c='dimmed' pb='xs' className='port-forwarding-image'>
            <Tooltip label={t('Device')}>
              <IconDeviceMobile size={28} stroke={1.5} />
            </Tooltip>
            <IconArrowRight size={18} />
            <Tooltip label={t('Host')}>
              <IconDeviceLaptop size={28} stroke={1.5} />
            </Tooltip>
          </Group>
          <Table.ScrollContainer minWidth={420} type='native'>
            <Table withRowBorders={false} verticalSpacing={4} horizontalSpacing={4} className={classes.forwards}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w='35%'>{t('Device')}</Table.Th>
                  <Table.Th colSpan={3}>{t('Host')}</Table.Th>
                  <Table.Th w={1} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={row.id} data-forward-id={row.id}>
                    <Table.Td>{field(row, 'devicePort', t('Port'))}</Table.Td>
                    <Table.Td w='40%'>{field(row, 'targetHost', t('Hostname'))}</Table.Td>
                    <Table.Td w={1}><Text span c='dimmed'>:</Text></Table.Td>
                    <Table.Td w='25%'>{field(row, 'targetPort', t('Port'))}</Table.Td>
                    <Table.Td>
                      <ActionIcon
                        variant='subtle'
                        color='red'
                        onClick={() => removeRow(row)}
                        aria-label={t('Remove')}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </form>}
    </WidgetCard>
  )
}
