export type ColumnSort = 'none' | 'sort-asc' | 'sort-desc'

export interface TableColumnData {
  name: string
  selected?: boolean | undefined
  sort: ColumnSort
}

export interface TableData {
  columns: TableColumnData[]
  sort: {index: number, reverse: boolean}
}

export function tableDataDefaults(columns: Array<{name: string, selected?: boolean}>, sortIndex = 0): TableData {
  return {
    columns: columns.map((column, index) => ({...column, sort: index === sortIndex ? 'sort-asc' : 'none'}))
    , sort: {index: sortIndex, reverse: false}
  }
}

export function normalizeTableData(stored: unknown, defaults: TableData): TableData {
  const data = stored as TableData | undefined
  const valid = Array.isArray(data?.columns) &&
    data.columns.length === defaults.columns.length &&
    data.columns.every((column, index) => column?.name === defaults.columns[index]!.name) &&
    typeof data.sort?.index === 'number' &&
    data.sort.index >= 0 &&
    data.sort.index < defaults.columns.length
  return valid ? data : defaults
}

export function toggleSort(data: TableData, index: number): TableData {
  const reverse = index === data.sort.index && !data.sort.reverse
  return {
    columns: data.columns.map((column, position) => {
      if (position === index) {
        return {...column, sort: reverse ? 'sort-desc' : 'sort-asc'}
      }
      return position === data.sort.index ? {...column, sort: 'none'} : column
    })
    , sort: {index, reverse}
  }
}

export function selectColumns(data: TableData, selected: boolean[]): TableData {
  return {
    ...data
    , columns: data.columns.map((column, index) => ({...column, selected: selected[index]}))
  }
}

export function sortState(data: TableData, index: number): ColumnSort {
  if (data.sort.index !== index) {
    return 'none'
  }
  return data.sort.reverse ? 'sort-desc' : 'sort-asc'
}

export function sortKey(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value
}
