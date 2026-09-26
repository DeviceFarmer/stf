import {useMemo, useState} from 'react'
import {
  Button
  , Center
  , Group
  , Loader
  , Paper
  , Table
  , Text
  , Tooltip
  , UnstyledButton
} from '@mantine/core'
import {IconLayoutGrid, IconMail} from '@tabler/icons-react'
import orderBy from 'lodash/orderBy'
import {formatDate, useDateFormat} from '@/core/date-format'
import {useTranslation} from '@/core/i18n'
import {useSetting} from '@/core/settings'
import {currentUser} from '@/core/user'
import {errorMessage} from '@/ui/modals'
import {ColumnChoice} from '@/ui/ColumnChoice'
import {mailTo} from '@/ui/mail'
import {NothingToShow} from '@/ui/NothingToShow'
import {Page} from '@/ui/Page'
import {usePageTitle} from '@/ui/page-title'
import {Pager, useItemsPerPage, usePaged} from '@/ui/Pager'
import {searchFilter} from '@/ui/paging'
import {SortIcon} from '@/ui/SortIcon'
import {
  normalizeTableData
  , selectColumns
  , sortKey
  , sortState
  , toggleSort
  , type TableData
} from '@/ui/table-model'
import {defaultGroupData, groupColumns, groupStatus, type GroupRow} from './columns'
import {GroupQuotaStats, GroupStats} from './GroupStats'
import {useQuotaUser, useViewGroups} from './use-view-groups'
import classes from './GroupListPage.module.css'

export default function GroupListPage() {
  const {t} = useTranslation()
  const groups = useViewGroups()
  const quotaUser = useQuotaUser()
  const dateFormat = useDateFormat()
  const [storedGroupData, setGroupData] = useSetting<unknown>('groupData', defaultGroupData)
  const [perPage, setPerPage] = useItemsPerPage('groupViewItemsPerPage')
  const [search, setSearch] = useState('')
  const groupData = normalizeTableData(storedGroupData, defaultGroupData)

  usePageTitle(t('Groups'))

  const rows = useMemo<GroupRow[]>(() => (groups.data || []).map((group) => ({
    group
    , status: groupStatus(group)
    , startTime: formatDate(group.dates?.[0]?.start, dateFormat)
    , stopTime: formatDate(group.dates?.[0]?.stop, dateFormat)
  })), [groups.data, dateFormat])

  const filtered = useMemo(() => {
    const column = groupColumns[groupData.sort.index]!
    const sorted = orderBy(
      rows
      , [(row: GroupRow) => sortKey(column.sortValue(row))]
      , [groupData.sort.reverse ? 'desc' : 'asc']
    )
    return searchFilter(sorted, search)
  }, [rows, groupData.sort.index, groupData.sort.reverse, search])

  const paged = usePaged(filtered, perPage)
  const visibleColumns = groupData.columns
    .map((column, index) => ({column, index}))
    .filter(({column}) => column.selected)

  function update(data: TableData) {
    setGroupData(data)
  }

  function renderGroups() {
    if (groups.isPending) {
      return <Center py={64}><Loader /></Center>
    }
    if (groups.isError) {
      return <NothingToShow message={errorMessage(groups.error)} />
    }
    if (!rows.length) {
      return <NothingToShow icon={<IconLayoutGrid size={30} />} message={t('No Groups')} />
    }
    return (
      <>
        <Group className={`${classes.toolbar} groups-header group-list-header`} justify='space-between' gap='sm'>
          <Group gap='sm' wrap='wrap'>
            <Pager
              searchLabel={t('Group selection')}
              search={search}
              onSearchChange={(value) => {
                setSearch(value)
                paged.setPage(1)
              }}
              perPage={perPage}
              onPerPageChange={(value) => {
                setPerPage(value)
                paged.setPage(1)
              }}
              page={paged.page}
              pageCount={paged.pageCount}
              onPageChange={paged.setPage}
              total={filtered.length}
            />
            <ColumnChoice
              items={groupData.columns.map((column) => ({
                id: column.name
                , label: t(column.name)
                , selected: Boolean(column.selected)
              }))}
              onChange={(items) => update(selectColumns(groupData, items.map((item) => item.selected)))}
              onReset={() => update(defaultGroupData)}
            />
          </Group>
          <Tooltip label={t('Write an email to the group owner selection')}>
            <Button
              size='xs'
              leftSection={<IconMail size={14} />}
              disabled={!filtered.length}
              onClick={() => mailTo(filtered.map((row) => row.group.owner.email))}
              className='contact-owners'
            >
              {t('Contact Owners')}
            </Button>
          </Tooltip>
        </Group>
        <Table.ScrollContainer minWidth={960} type='native'>
          <Table highlightOnHover verticalSpacing='sm' className={`${classes.table} groups-table`}>
            <Table.Thead>
              <Table.Tr>
                {visibleColumns.map(({column, index}) => (
                  <Table.Th key={column.name} className={classes.th}>
                    <UnstyledButton
                      className={classes.sortButton}
                      onClick={() => update(toggleSort(groupData, index))}
                    >
                      <span>{t(column.name)}</span>
                      <SortIcon sort={sortState(groupData, index)} />
                    </UnstyledButton>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {paged.items.map((row) => (
                <Table.Tr key={row.group.id}>
                  {visibleColumns.map(({column, index}) => (
                    <Table.Td key={column.name}>{groupColumns[index]!.render(row)}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!filtered.length && (
          <Text size='sm' c='dimmed' ta='center' py='lg'>{t('No results')}</Text>
        )}
      </>
    )
  }

  return (
    <Page className='stf-group-list stf-groups' innerClassName={classes.inner} maxWidth={1680}>
      <GroupStats groups={groups.data || []} />
      <GroupQuotaStats user={quotaUser.data || currentUser} />
      <Paper withBorder className={`${classes.tableCard} group-list`}>
        {renderGroups()}
      </Paper>
    </Page>
  )
}
