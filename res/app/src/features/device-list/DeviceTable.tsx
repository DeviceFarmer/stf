import {memo} from 'react'
import {Group, Table, UnstyledButton} from '@mantine/core'
import {IconArrowDown, IconArrowUp} from '@tabler/icons-react'
import type {Device} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {columnDefinition, type CellContext} from './columns'
import {sortEntries, type SortSetting} from './list-model'
import classes from './DeviceList.module.css'

const DeviceRow = memo(function DeviceRow({device, columnIds, context}: {
  device: Device
  columnIds: string[]
  context: CellContext
}) {
  return (
    <Table.Tr className={device.usable ? undefined : `device-not-usable ${classes.notUsable}`}>
      {columnIds.map((id) => (
        <Table.Td key={id} className={id === 'name' || id === 'operator' ? classes.wrapCell : undefined}>
          {columnDefinition(id)?.render(device, context)}
        </Table.Td>
      ))}
    </Table.Tr>
  )
})

export function DeviceTable({devices, columnIds, sort, onSort, context}: {
  devices: Device[]
  columnIds: string[]
  sort: SortSetting
  onSort: (name: string, multiple: boolean) => void
  context: CellContext
}) {
  const {t} = useTranslation()
  const entries = sortEntries(sort)

  return (
    <Table
      stickyHeader
      highlightOnHover
      verticalSpacing={6}
      className={`device-list-details-content ${classes.table}`}
    >
      <Table.Thead>
        <Table.Tr>
          {columnIds.map((id) => {
            const sorted = entries.find((entry) => entry.name === id)?.order
            const title = columnDefinition(id)?.title || id
            return (
              <Table.Th
                key={id}
                className={`sortable sort-${sorted || 'none'} ${classes.sortable}`}
                onClick={(event) => onSort(id, event.shiftKey)}
              >
                <UnstyledButton className={classes.sortButton}>
                  <Group gap={4} wrap='nowrap'>
                    <span>{t(title)}</span>
                    {sorted === 'asc' && <IconArrowUp size={12} />}
                    {sorted === 'desc' && <IconArrowDown size={12} />}
                  </Group>
                </UnstyledButton>
              </Table.Th>
            )
          })}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {devices.map((device) => (
          <DeviceRow key={device.serial} device={device} columnIds={columnIds} context={context} />
        ))}
      </Table.Tbody>
    </Table>
  )
}
