import {useCallback, useMemo, useState} from 'react'
import {Badge, CloseButton, Group, Pagination, Select, TextInput, Tooltip} from '@mantine/core'
import {IconSearch} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {useSetting} from '@/core/settings'
import {defaultItemsPerPage, itemsPerPageOptions, paginate, perPageOption, perPageValue} from './paging'

const perPageData = itemsPerPageOptions.map((option) => ({value: String(option.value), label: option.name}))

export function useItemsPerPage(settingKey: string): [number, (value: number) => void] {
  const [stored, setStored] = useSetting<unknown>(settingKey, defaultItemsPerPage)
  const setPerPage = useCallback((value: number) => setStored(perPageOption(value)), [setStored])
  return [perPageValue(stored), setPerPage]
}

export function usePaged<T>(items: T[], perPage: number) {
  const [page, setPage] = useState(1)
  const paged = useMemo(() => paginate(items, page, perPage), [items, page, perPage])
  return {...paged, setPage}
}

export function SearchInput({value, onChange, label, className, w}: {
  value: string
  onChange: (value: string) => void
  label: string
  className?: string
  w?: number
}) {
  const {t} = useTranslation()
  return (
    <TextInput
      className={className}
      w={w}
      size='xs'
      type='search'
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={t('Search')}
      aria-label={label}
      leftSection={(
        <Tooltip label={label}>
          <IconSearch size={14} />
        </Tooltip>
      )}
      leftSectionPointerEvents='all'
      rightSection={value ? <CloseButton size='xs' onClick={() => onChange('')} aria-label={t('Clear')} /> : null}
    />
  )
}

export function PerPageSelect({value, onChange, inPopover}: {
  value: number
  onChange: (value: number) => void
  inPopover?: boolean
}) {
  const {t} = useTranslation()
  return (
    <Select
      size='xs'
      w={76}
      aria-label={t('Items per page')}
      allowDeselect={false}
      data={perPageData}
      value={String(value)}
      onChange={(selected) => selected !== null && onChange(Number(selected))}
      comboboxProps={{withinPortal: !inPopover}}
    />
  )
}

export function PageControls({page, pageCount, onPageChange, total, totalClassName}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  total: number
  totalClassName?: string
}) {
  return (
    <Group gap='xs' wrap='nowrap'>
      {pageCount > 1 && (
        <Pagination
          size='sm'
          total={pageCount}
          value={page}
          onChange={onPageChange}
          siblings={0}
          boundaries={1}
          withEdges
        />
      )}
      <Badge
        variant='light'
        size='lg'
        radius='sm'
        className={totalClassName ? `stf-pager-total-items ${totalClassName}` : 'stf-pager-total-items'}
      >
        {total}
      </Badge>
    </Group>
  )
}

export function Pager({
  searchLabel
  , search
  , onSearchChange
  , searchWidth = 220
  , perPage
  , onPerPageChange
  , page
  , pageCount
  , onPageChange
  , total
  , inPopover
}: {
  searchLabel: string
  search: string
  onSearchChange: (search: string) => void
  searchWidth?: number
  perPage: number
  onPerPageChange: (perPage: number) => void
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  total: number
  inPopover?: boolean
}) {
  return (
    <Group gap='xs' wrap='wrap' className='stf-pager'>
      <SearchInput value={search} onChange={onSearchChange} label={searchLabel} w={searchWidth} />
      <PerPageSelect value={perPage} onChange={onPerPageChange} inPopover={inPopover} />
      <PageControls page={page} pageCount={pageCount} onPageChange={onPageChange} total={total} />
    </Group>
  )
}
