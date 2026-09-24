import {Button} from '@mantine/core'
import {IconBan, IconX} from '@tabler/icons-react'
import type {Group as StfGroup} from '@/core/groups-api'
import {gettext, useTranslation} from '@/core/i18n'
import {tableDataDefaults} from '@/ui/table-model'
import {ObjectsTable, type ObjectsColumn} from './shared/ObjectsTable'
import {clearGroupConflicts} from './store'
import type {ConflictRow} from './types'
import classes from './GroupsSettings.module.css'

const conflictColumns: ObjectsColumn<ConflictRow>[] = [
  {name: gettext('Serial'), render: (row) => row.serial, sortValue: (row) => row.serial}
  , {name: gettext('Starting Date'), render: (row) => row.startDate, sortValue: (row) => row.start}
  , {name: gettext('Expiration Date'), render: (row) => row.stopDate, sortValue: (row) => row.stop}
  , {name: gettext('Group Name'), render: (row) => row.group, sortValue: (row) => row.group}
  , {
    name: gettext('Group Owner')
    , render: (row) => <a className={classes.link} href={`mailto:${row.ownerEmail}`}>{row.ownerName}</a>
    , sortValue: (row) => row.ownerName
  }
]

const defaultConflictData = tableDataDefaults(conflictColumns.map((column) => ({name: column.name})))

export function GroupConflicts({group, conflicts}: {group: StfGroup, conflicts: ConflictRow[]}) {
  const {t} = useTranslation()
  return (
    <div className='group-conflicts'>
      <ObjectsTable
        rows={conflicts}
        rowKey={(row) => `${row.serial}|${row.start}|${row.group}`}
        columns={conflictColumns}
        settingKey='conflictData'
        defaultData={defaultConflictData}
        searchLabel={t('Conflicts')}
        emptyMessage={t('Conflicts')}
        emptyIcon={<IconBan size={30} />}
        withSelection={false}
        actions={() => (
          <Button
            size='xs'
            variant='default'
            leftSection={<IconX size={14} />}
            onClick={() => clearGroupConflicts(group.id)}
          >
            {t('Close')}
          </Button>
        )}
      />
    </div>
  )
}
