import type {ReactNode} from 'react'
import {Anchor, Badge, Group, Text} from '@mantine/core'
import {IconLayoutGrid} from '@tabler/icons-react'
import {getClassName, getDuration} from '@/core/common'
import {gettext, useTranslation} from '@/core/i18n'
import type {Group as StfGroup} from '@/core/groups-api'
import {tableDataDefaults} from '@/ui/table-model'
import {GroupDevicesButton, GroupUsersButton} from './GroupMembers'
import classes from './GroupListPage.module.css'

export type GroupStatus = 'Active' | 'Pending' | 'Waiting' | 'Ready'

export interface GroupRow {
  group: StfGroup
  status: GroupStatus | ''
  startTime: string
  stopTime: string
}

export interface ColumnDefinition {
  name: string
  sortValue: (row: GroupRow) => unknown
  render: (row: GroupRow) => ReactNode
}

const statusColors: Record<GroupStatus, string> = {
  Active: 'green'
  , Pending: 'red'
  , Ready: 'orange'
  , Waiting: 'gray'
}

const statusLabels: Record<GroupStatus, string> = {
  Active: gettext('Active')
  , Pending: gettext('Pending')
  , Waiting: gettext('Waiting')
  , Ready: gettext('Ready')
}

function StatusBadge({status}: {status: GroupStatus}) {
  const {t} = useTranslation()
  return (
    <Badge variant='light' color={statusColors[status]} radius='sm' className='group-status'>
      {t(statusLabels[status])}
    </Badge>
  )
}

export const groupColumns: ColumnDefinition[] = [
  {
    name: gettext('Status')
    , sortValue: (row) => row.status
    , render: (row) => (row.status ? <StatusBadge status={row.status} /> : null)
  }
  , {
    name: gettext('Name')
    , sortValue: (row) => row.group.name
    , render: (row) => (
      <Group gap='xs' wrap='nowrap' className='selectable'>
        <IconLayoutGrid size={16} className={classes.groupIcon} />
        <Text size='sm' fw={500} className='group-list-name'>{row.group.name}</Text>
      </Group>
    )
  }
  , {
    name: gettext('Identifier')
    , sortValue: (row) => row.group.id
    , render: (row) => <Text size='xs' ff='monospace' className='selectable'>{row.group.id}</Text>
  }
  , {
    name: gettext('Owner')
    , sortValue: (row) => row.group.owner?.name
    , render: (row) => <Anchor size='sm' href={`mailto:${row.group.owner?.email}`}>{row.group.owner?.name}</Anchor>
  }
  , {
    name: gettext('Devices')
    , sortValue: (row) => row.group.devices.length
    , render: (row) => <GroupDevicesButton group={row.group} />
  }
  , {
    name: gettext('Users')
    , sortValue: (row) => row.group.users.length
    , render: (row) => <GroupUsersButton group={row.group} />
  }
  , {name: gettext('Class'), sortValue: (row) => row.group.class, render: (row) => getClassName(row.group.class)}
  , {name: gettext('Repetitions'), sortValue: (row) => row.group.repetitions, render: (row) => row.group.repetitions}
  , {
    name: gettext('Duration')
    , sortValue: (row) => row.group.duration
    , render: (row) => (typeof row.group.duration === 'number' ? getDuration(row.group.duration) : '')
  }
  , {
    name: gettext('Starting Date')
    , sortValue: (row) => row.group.dates?.[0]?.start
    , render: (row) => <Text size='sm' className={classes.nowrap}>{row.startTime}</Text>
  }
  , {
    name: gettext('Expiration Date')
    , sortValue: (row) => row.group.dates?.[0]?.stop
    , render: (row) => <Text size='sm' className={classes.nowrap}>{row.stopTime}</Text>
  }
]

const hiddenByDefault = new Set(['Identifier'])

export const defaultGroupData = tableDataDefaults(
  groupColumns.map((column) => ({name: column.name, selected: !hiddenByDefault.has(column.name)}))
  , groupColumns.findIndex((column) => column.name === 'Name')
)

const statusNames: Record<string, GroupStatus> = {pending: 'Pending', waiting: 'Waiting', ready: 'Ready'}

export function groupStatus(group: StfGroup): GroupStatus | '' {
  if (group.isActive) {
    return 'Active'
  }
  return statusNames[group.state || ''] || ''
}
