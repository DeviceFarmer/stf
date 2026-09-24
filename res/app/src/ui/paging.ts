export interface ItemsPerPageOption {
  name: string
  value: number
}

export const itemsPerPageOptions: ItemsPerPageOption[] = [
  {name: '1', value: 1}
  , {name: '5', value: 5}
  , {name: '10', value: 10}
  , {name: '20', value: 20}
  , {name: '50', value: 50}
  , {name: '100', value: 100}
  , {name: '200', value: 200}
  , {name: '500', value: 500}
  , {name: '1000', value: 1000}
  , {name: '*', value: 0}
]

export const defaultItemsPerPage = itemsPerPageOptions[2]

export function perPageOption(value: number): ItemsPerPageOption {
  return itemsPerPageOptions.find((option) => option.value === value) || defaultItemsPerPage
}

export function perPageValue(stored: unknown, fallback = defaultItemsPerPage.value): number {
  if (typeof stored === 'number') {
    return stored
  }
  if (stored && typeof stored === 'object' && typeof (stored as ItemsPerPageOption).value === 'number') {
    return (stored as ItemsPerPageOption).value
  }
  return fallback
}

function deepMatch(value: unknown, needle: string): boolean {
  if (value === null || value === undefined || typeof value === 'function') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some((item) => deepMatch(item, needle))
  }
  if (typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => !key.startsWith('$') && deepMatch(item, needle))
  }
  return String(value).toLowerCase().includes(needle)
}

export function matchesSearch(value: unknown, search: string): boolean {
  const negated = search.startsWith('!')
  const needle = (negated ? search.slice(1) : search).toLowerCase()
  return !needle || deepMatch(value, needle) !== negated
}

export function searchFilter<T>(items: T[], search: string): T[] {
  return search ? items.filter((item) => matchesSearch(item, search)) : items
}

export interface Page<T> {
  items: T[]
  page: number
  pageCount: number
}

export function paginate<T>(items: T[], page: number, perPage: number): Page<T> {
  if (!perPage) {
    return {items, page: 1, pageCount: 1}
  }
  const pageCount = Math.max(1, Math.ceil(items.length / perPage))
  const current = Math.min(Math.max(1, page), pageCount)
  return {
    items: items.slice((current - 1) * perPage, current * perPage)
    , page: current
    , pageCount
  }
}
