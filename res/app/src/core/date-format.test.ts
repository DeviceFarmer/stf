import {describe, expect, it} from 'vitest'
import {defaultDateFormat, formatDate, fromDatetimeLocal, toDatetimeLocal} from './date-format'

const date = new Date(2026, 0, 5, 14, 7, 9, 42)

describe('formatDate', () => {
  it('formats the default STF pattern', () => {
    expect(formatDate(date, defaultDateFormat)).toBe('1/5/26 2:07:09 PM')
  })

  it('supports padded, named and literal tokens', () => {
    expect(formatDate(date, 'yyyy-MM-dd HH:mm:ss.sss')).toBe('2026-01-05 14:07:09.042')
    expect(formatDate(date, 'EEEE, MMMM d')).toBe('Monday, January 5')
    expect(formatDate(date, 'EEE MMM yy')).toBe('Mon Jan 26')
    expect(formatDate(date, '\'week\' w, \'\'G\'\'')).toBe('week 2, \'AD\'')
    expect(formatDate(date, 'longDate')).toBe('January 5, 2026')
  })

  it('falls back to mediumDate like Angular when no format is given', () => {
    expect(formatDate(date, '')).toBe('Jan 5, 2026')
    expect(formatDate(date)).toBe('Jan 5, 2026')
  })

  it('returns empty strings for missing values and the raw value for invalid ones', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate('not a date')).toBe('not a date')
  })

  it('accepts ISO strings and timestamps', () => {
    expect(formatDate(date.toISOString(), 'M/d/yy')).toBe('1/5/26')
    expect(formatDate(date.getTime(), 'h:mm a')).toBe('2:07 PM')
  })
})

describe('datetime-local conversion', () => {
  it('round trips a date', () => {
    const value = toDatetimeLocal(date)
    expect(value).toBe('2026-01-05T14:07:09')
    expect(fromDatetimeLocal(value).getTime()).toBe(new Date(2026, 0, 5, 14, 7, 9).getTime())
  })

  it('handles empty and invalid values', () => {
    expect(toDatetimeLocal(new Date(NaN))).toBe('')
    expect(Number.isNaN(fromDatetimeLocal('').getTime())).toBe(true)
  })
})
