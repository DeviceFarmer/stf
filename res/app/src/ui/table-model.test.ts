import {describe, expect, it} from 'vitest'
import {normalizeTableData, selectColumns, sortState, tableDataDefaults, toggleSort} from './table-model'

const userDefaults = tableDataDefaults([{name: 'Name'}, {name: 'Email'}, {name: 'Privilege'}])
const groupDefaults = tableDataDefaults(
  [{name: 'Status', selected: true}, {name: 'Name', selected: true}, {name: 'Identifier', selected: false}]
  , 1
)

describe('tableDataDefaults', () => {
  it('builds the stored shape the Angular UI used', () => {
    expect(userDefaults).toEqual({
      columns: [{name: 'Name', sort: 'sort-asc'}, {name: 'Email', sort: 'none'}, {name: 'Privilege', sort: 'none'}]
      , sort: {index: 0, reverse: false}
    })
    expect(groupDefaults.columns[1]).toEqual({name: 'Name', selected: true, sort: 'sort-asc'})
    expect(groupDefaults.sort).toEqual({index: 1, reverse: false})
  })
})

describe('normalizeTableData', () => {
  it('keeps compatible stored data as is', () => {
    const stored = {
      columns: [{name: 'Name', sort: 'none'}, {name: 'Email', sort: 'sort-desc'}, {name: 'Privilege', sort: 'none'}]
      , sort: {index: 1, reverse: true}
    }
    expect(normalizeTableData(stored, userDefaults)).toBe(stored)
  })

  it('falls back to the defaults for incompatible data', () => {
    expect(normalizeTableData(undefined, userDefaults)).toBe(userDefaults)
    expect(normalizeTableData({columns: [{name: 'Name', sort: 'none'}], sort: {index: 0}}, userDefaults))
      .toBe(userDefaults)
    expect(normalizeTableData({...userDefaults, sort: {index: 3, reverse: false}}, userDefaults)).toBe(userDefaults)
  })
})

describe('toggleSort', () => {
  it('sorts a new column ascending and resets the previous one', () => {
    const next = toggleSort(groupDefaults, 0)
    expect(next.sort).toEqual({index: 0, reverse: false})
    expect(next.columns.map((column) => column.sort)).toEqual(['sort-asc', 'none', 'none'])
    expect(next.columns[2]).toEqual({name: 'Identifier', selected: false, sort: 'none'})
    expect(sortState(next, 0)).toBe('sort-asc')
    expect(sortState(next, 1)).toBe('none')
  })

  it('reverses the current column on a second click', () => {
    const once = toggleSort(userDefaults, 0)
    expect(once.sort).toEqual({index: 0, reverse: true})
    expect(once.columns[0]).toEqual({name: 'Name', sort: 'sort-desc'})
    expect(sortState(once, 0)).toBe('sort-desc')
    expect(toggleSort(once, 0)).toEqual(userDefaults)
  })
})

describe('selectColumns', () => {
  it('only changes the selected flags', () => {
    expect(selectColumns(groupDefaults, [false, true, true])).toEqual({
      ...groupDefaults
      , columns: [
        {name: 'Status', selected: false, sort: 'none'}
        , {name: 'Name', selected: true, sort: 'sort-asc'}
        , {name: 'Identifier', selected: true, sort: 'none'}
      ]
    })
  })
})
