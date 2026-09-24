import type {Device} from '@/core/devices/types'
import {columnDefinition, defaultColumns, type ColumnSetting, type SortOrder} from './columns'
import type {QueryTerm} from './query-parser'

export interface SortEntry {
  name: string
  order: SortOrder
}

export interface SortSetting {
  fixed: SortEntry[]
  user: SortEntry[]
}

export interface ActiveTabs {
  icons: boolean
  details: boolean
}

export const defaultSort: SortSetting = {
  fixed: [{name: 'state', order: 'asc'}]
  , user: [{name: 'name', order: 'asc'}]
}

export const defaultActiveTabs: ActiveTabs = {icons: true, details: false}

export function normalizeColumns(stored: unknown): ColumnSetting[] {
  if (!Array.isArray(stored)) {
    return defaultColumns
  }
  const known = new Set<string>()
  const columns: ColumnSetting[] = []
  for (const column of stored) {
    if (column && columnDefinition(column.name) && !known.has(column.name)) {
      known.add(column.name)
      columns.push({name: column.name, selected: Boolean(column.selected)})
    }
  }
  return columns.concat(defaultColumns.filter((column) => !known.has(column.name)))
}

function validEntries(entries: unknown): SortEntry[] | null {
  return Array.isArray(entries) ?
    entries.filter((entry) => entry && columnDefinition(entry.name)) :
    null
}

export function normalizeSort(stored: unknown): SortSetting {
  const value = stored as Partial<SortSetting> | undefined
  return {
    fixed: validEntries(value?.fixed) || defaultSort.fixed
    , user: validEntries(value?.user) || defaultSort.user
  }
}

export function sortEntries(sort: SortSetting): SortEntry[] {
  return sort.fixed.concat(sort.user)
}

function swap(order: SortOrder): SortOrder {
  return order === 'asc' ? 'desc' : 'asc'
}

export function nextSort(sort: SortSetting, name: string, multiple: boolean): SortSetting {
  if (sort.fixed.some((entry) => entry.name === name)) {
    return {
      ...sort
      , fixed: sort.fixed.map((entry) => (entry.name === name ? {...entry, order: swap(entry.order)} : entry))
    }
  }

  const match = sort.user.find((entry) => entry.name === name)
  if (match) {
    const toggled = {...match, order: swap(match.order)}
    return {
      ...sort
      , user: multiple ? sort.user.map((entry) => (entry.name === name ? toggled : entry)) : [toggled]
    }
  }

  const added: SortEntry = {name, order: columnDefinition(name)?.defaultOrder || 'asc'}
  return {...sort, user: multiple ? sort.user.concat(added) : [added]}
}

export function matchDevice(
  device: Device
, terms: QueryTerm[]
, activeColumns: string[]
, language: string
): boolean {
  return terms.every((term) => {
    if (term.field) {
      const column = columnDefinition(term.field)
      return !column || column.filter(device, term, language)
    }
    return activeColumns.some((name) => columnDefinition(name)?.filter(device, term, language))
  })
}

export function deviceComparator(entries: SortEntry[], language: string): (a: Device, b: Device) => number {
  const resolved = entries.flatMap((entry) => {
    const column = columnDefinition(entry.name)
    return column ? [{compare: column.compare, direction: entry.order === 'desc' ? -1 : 1}] : []
  })
  return (a, b) => {
    for (const {compare, direction} of resolved) {
      const diff = compare(a, b, language)
      if (diff !== 0) {
        return diff * direction
      }
    }
    return 0
  }
}
