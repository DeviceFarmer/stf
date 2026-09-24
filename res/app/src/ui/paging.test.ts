import {describe, expect, it} from 'vitest'
import {matchesSearch, paginate, perPageOption, perPageValue, searchFilter} from './paging'

const groups = [
  {name: 'Common', owner: {email: 'admin@example.com'}, users: ['alice@example.com'], $meta: 'hidden'}
  , {name: 'Lab', owner: {email: 'bob@example.com'}, users: ['bob@example.com'], $meta: 'hidden'}
]

describe('searchFilter', () => {
  it('matches nested values case-insensitively like the Angular filter', () => {
    expect(searchFilter(groups, 'ALICE').map((group) => group.name)).toEqual(['Common'])
    expect(searchFilter(groups, '').length).toBe(2)
  })

  it('negates with a leading exclamation mark', () => {
    expect(searchFilter(groups, '!alice').map((group) => group.name)).toEqual(['Lab'])
    expect(searchFilter(groups, '!').length).toBe(2)
  })

  it('ignores $-prefixed keys', () => {
    expect(matchesSearch(groups[0], 'hidden')).toBe(false)
  })
})

describe('paginate', () => {
  const items = Array.from({length: 23}, (_, index) => index)

  it('slices pages and clamps the page number', () => {
    expect(paginate(items, 3, 10)).toEqual({items: [20, 21, 22], page: 3, pageCount: 3})
    expect(paginate(items, 9, 10).page).toBe(3)
    expect(paginate([], 1, 10)).toEqual({items: [], page: 1, pageCount: 1})
  })

  it('shows everything for the * option', () => {
    expect(paginate(items, 2, 0)).toEqual({items, page: 1, pageCount: 1})
  })
})

describe('items per page', () => {
  it('reads stored options, numbers and garbage', () => {
    expect(perPageValue({name: '50', value: 50})).toBe(50)
    expect(perPageValue(20)).toBe(20)
    expect(perPageValue(undefined)).toBe(10)
    expect(perPageValue('x', 5)).toBe(5)
  })

  it('maps values back to the stored option shape', () => {
    expect(perPageOption(0)).toEqual({name: '*', value: 0})
    expect(perPageOption(7)).toEqual({name: '10', value: 10})
  })
})
