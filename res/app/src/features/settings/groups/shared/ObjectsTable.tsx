import {useMemo, useState, type ReactNode} from 'react'
import {Checkbox, Group, Stack, Table, Text, UnstyledButton} from '@mantine/core'
import {useTranslation} from '@/core/i18n'
import {useSetting} from '@/core/settings'
import {ColumnChoice} from '@/ui/ColumnChoice'
import {NothingToShow} from '@/ui/NothingToShow'
import {PageControls, PerPageSelect, SearchInput, usePaged} from '@/ui/Pager'
import {defaultItemsPerPage, searchFilter} from '@/ui/paging'
import {toggled} from '@/ui/selection'
import {SortIcon} from '@/ui/SortIcon'
import {normalizeTableData, selectColumns, sortState, toggleSort, type TableData} from '@/ui/table-model'
import classes from './ObjectsTable.module.css'

export interface ObjectsColumn<T> {
  name: string
  render: (row: T) => ReactNode
  sortValue: (row: T) => string | number | undefined
}

const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})

function compareValues(a: string | number | undefined, b: string | number | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  return collator.compare(String(a ?? ''), String(b ?? ''))
}

export interface ObjectsTableProps<T> {
  rows: T[]
  rowKey: (row: T) => string
  columns: ObjectsColumn<T>[]
  settingKey: string
  defaultData: TableData
  columnChoice?: boolean
  searchLabel: string
  emptyMessage: string
  emptyIcon?: ReactNode
  canSelect?: (row: T) => boolean
  rowAction?: (row: T) => ReactNode
  actions?: (selected: T[], clearSelection: () => void) => ReactNode
  withSelection?: boolean
}

export function ObjectsTable<T>({
  rows
  , rowKey
  , columns
  , settingKey
  , defaultData
  , columnChoice
  , searchLabel
  , emptyMessage
  , emptyIcon
  , canSelect = () => true
  , rowAction
  , actions
  , withSelection = true
}: ObjectsTableProps<T>) {
  const {t} = useTranslation()
  const [storedData, setData] = useSetting<unknown>(settingKey, defaultData)
  const data = normalizeTableData(storedData, defaultData)
  const [search, setSearch] = useState('')
  const [perPage, setPerPage] = useState(defaultItemsPerPage.value)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const filtered = useMemo(() => {
    const matching = searchFilter(rows, search).slice()
    const column = columns[data.sort.index]
    if (!column) {
      return matching
    }
    const sorted = matching.sort((a, b) => compareValues(column.sortValue(a), column.sortValue(b)))
    return data.sort.reverse ? sorted.reverse() : sorted
  }, [rows, search, columns, data.sort.index, data.sort.reverse])

  const {items: pageItems, page, pageCount, setPage} = usePaged(filtered, perPage)
  const selectable = filtered.filter(canSelect)
  const selectedRows = selectable.filter((row) => selected.has(rowKey(row)))
  const allSelected = selectable.length > 0 && selectedRows.length === selectable.length
  const visibleColumns = columns
    .map((column, index) => ({column, index}))
    .filter(({index}) => data.columns[index]?.selected !== false)

  function clearSelection() {
    setSelected(new Set())
  }

  return (
    <Stack gap='sm'>
      <Group justify='space-between' gap='xs'>
        <Group gap='xs'>
          <SearchInput
            className={classes.search}
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            label={searchLabel}
          />
          {actions?.(selectedRows, clearSelection)}
        </Group>
        <Group gap='xs'>
          {columnChoice && (
            <ColumnChoice
              compact
              position='bottom-end'
              items={data.columns.map((column) => ({
                id: column.name
                , label: t(column.name)
                , selected: column.selected !== false
              }))}
              onChange={(items) => setData(selectColumns(data, items.map((item) => item.selected)))}
              onReset={() => setData(defaultData)}
            />
          )}
          <PerPageSelect
            value={perPage}
            onChange={(value) => {
              setPerPage(value)
              setPage(1)
            }}
          />
        </Group>
      </Group>
      {filtered.length === 0 ?
        <NothingToShow message={emptyMessage} icon={emptyIcon} /> :
        <Table.ScrollContainer minWidth={420} type='native'>
          <Table highlightOnHover verticalSpacing={6} className={classes.table}>
            <Table.Thead>
              <Table.Tr>
                {withSelection && (
                  <Table.Th className={classes.checkCell}>
                    <Checkbox
                      size='xs'
                      aria-label={t('Select all')}
                      checked={allSelected}
                      indeterminate={selectedRows.length > 0 && !allSelected}
                      disabled={selectable.length === 0}
                      onChange={() => setSelected(
                        allSelected ? new Set() : new Set(selectable.map(rowKey))
                      )}
                    />
                  </Table.Th>
                )}
                {rowAction && <Table.Th className={classes.actionCell} />}
                {visibleColumns.map(({column, index}) => (
                  <Table.Th key={column.name}>
                    <UnstyledButton
                      className={classes.sortHeader}
                      onClick={() => setData(toggleSort(data, index))}
                    >
                      <span>{t(column.name)}</span>
                      <SortIcon sort={sortState(data, index)} />
                    </UnstyledButton>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pageItems.map((row) => {
                const key = rowKey(row)
                const isSelectable = canSelect(row)
                return (
                  <Table.Tr
                    key={key}
                    className='selectable'
                    data-key={key}
                    bg={isSelectable && selected.has(key) ? 'var(--mantine-primary-color-light)' : undefined}
                  >
                    {withSelection && (
                      <Table.Td className={classes.checkCell}>
                        <Checkbox
                          size='xs'
                          aria-label={key}
                          disabled={!isSelectable}
                          checked={isSelectable && selected.has(key)}
                          onChange={() => setSelected((current) => toggled(current, key))}
                        />
                      </Table.Td>
                    )}
                    {rowAction && <Table.Td className={classes.actionCell}>{rowAction(row)}</Table.Td>}
                    {visibleColumns.map(({column}) => (
                      <Table.Td key={column.name}>{column.render(row)}</Table.Td>
                    ))}
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>}
      <Group justify='space-between' gap='xs'>
        <Text size='xs' c='dimmed'>
          {selectedRows.length ? t('{{count}} selected', {count: selectedRows.length}) : ''}
        </Text>
        <PageControls page={page} pageCount={pageCount} onPageChange={setPage} total={filtered.length} />
      </Group>
    </Stack>
  )
}
