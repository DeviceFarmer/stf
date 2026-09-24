import {describe, expect, it} from 'vitest'
import {getClassDuration, getClassName, getDuration} from './common'

describe('common', () => {
  it('formats durations with the largest units first', () => {
    expect(getDuration(500)).toBe('0s')
    expect(getDuration(61000)).toBe('1m 1s')
    expect(getDuration(3600 * 1000)).toBe('1h')
    expect(getDuration((26 * 3600 + 5) * 1000)).toBe('1d 2h 5s')
  })

  it('looks up group classes', () => {
    expect(getClassName('bookable')).toBe('Bookable')
    expect(getClassDuration('once')).toBe(Infinity)
    expect(getClassName('missing')).toBe('')
  })
})
