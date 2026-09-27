import {describe, expect, it} from 'vitest'
import {
  defaultFilters
  , enhanceEntry
  , filterEntries
  , formatLogs
  , isValidDateFilter
  , levelNumbers
  , logFileName
  , sanitizePid
  , sanitizeTid
  , stringMatcher
  , type LogcatMessage
} from './logcat'

function message(overrides: Partial<LogcatMessage>): LogcatMessage {
  return {
    serial: 'serial-1'
    , date: new Date(2024, 0, 1, 9, 5, 7, 42).getTime() / 1000
    , pid: 1234
    , tid: 1240
    , priority: 4
    , tag: 'ActivityManager'
    , message: 'Start proc'
    , ...overrides
  }
}

const entries = [
  enhanceEntry(message({priority: 2, tag: 'Zygote', message: 'verbose line'}), 1)
  , enhanceEntry(message({priority: 3, pid: 77, tid: 78, message: 'debug line'}), 2)
  , enhanceEntry(message({priority: 5, tag: 'WindowManager', message: 'warn line'}), 3)
  , enhanceEntry(message({priority: 6, message: 'error line'}), 4)
]

describe('enhanceEntry', () => {
  it('labels the date and priority like LogcatService', () => {
    const entry = entries[1]!
    expect(entry.dateLabel).toBe('09:05:07.042')
    expect(entry.priorityLabel).toBe('Debug')
    expect(entry.deviceLabel).toBe('Android')
  })

  it('offers the Verbose to Fatal levels', () => {
    expect(levelNumbers.map((level) => level.name)).toEqual(['Verbose', 'Debug', 'Info', 'Warn', 'Error', 'Fatal'])
    expect(levelNumbers[0]!.number).toBe(2)
  })
})

describe('stringMatcher', () => {
  it('matches substrings case-insensitively', () => {
    expect(stringMatcher('activity')('ActivityManager')).toBe(true)
    expect(stringMatcher('zygote')('ActivityManager')).toBe(false)
  })

  it('negates with a leading bang', () => {
    expect(stringMatcher('!activity')('ActivityManager')).toBe(false)
    expect(stringMatcher('!zygote')('ActivityManager')).toBe(true)
  })

  it('supports regular expressions and ignores incomplete or invalid ones', () => {
    expect(stringMatcher('/^Act.*ger$/')('ActivityManager')).toBe(true)
    expect(stringMatcher('/^act/')('ActivityManager')).toBe(false)
    expect(stringMatcher('/^act/i')('ActivityManager')).toBe(true)
    expect(stringMatcher('/^act')('Zygote')).toBe(true)
    expect(stringMatcher('/([/')('Zygote')).toBe(true)
  })
})

describe('filterEntries', () => {
  it('keeps everything with the default filters', () => {
    expect(filterEntries(entries, defaultFilters, true)).toBe(entries)
  })

  it('filters by minimum priority', () => {
    const result = filterEntries(entries, {...defaultFilters, priority: 5}, true)
    expect(result.map((entry) => entry.id)).toEqual([3, 4])
  })

  it('filters by tag, pid, tid and text', () => {
    expect(filterEntries(entries, {...defaultFilters, tag: 'window'}, true).map((entry) => entry.id)).toEqual([3])
    expect(filterEntries(entries, {...defaultFilters, pid: '77'}, true).map((entry) => entry.id)).toEqual([2])
    expect(filterEntries(entries, {...defaultFilters, tid: '78'}, true).map((entry) => entry.id)).toEqual([2])
    expect(filterEntries(entries, {...defaultFilters, message: 'error'}, true).map((entry) => entry.id)).toEqual([4])
  })

  it('ignores the native-only filters on the web platform', () => {
    expect(filterEntries(entries, {...defaultFilters, tag: 'window'}, false)).toBe(entries)
  })

  it('filters by time label', () => {
    expect(filterEntries(entries, {...defaultFilters, date: '09:05'}, true)).toHaveLength(4)
    expect(filterEntries(entries, {...defaultFilters, date: '10:'}, true)).toHaveLength(0)
  })
})

describe('input sanitizing', () => {
  it('keeps digits and colons in pid and digits in tid', () => {
    expect(sanitizePid('12a:3')).toBe('12:3')
    expect(sanitizeTid('12a:3')).toBe('123')
  })

  it('validates time filters', () => {
    expect(isValidDateFilter('')).toBe(true)
    expect(isValidDateFilter('09:05:07.042')).toBe(true)
    expect(isValidDateFilter('05:07')).toBe(true)
    expect(isValidDateFilter('abc')).toBe(false)
  })
})

describe('formatLogs', () => {
  it('writes tab separated lines for the log format', () => {
    const output = formatLogs('serial-1', entries, 'log')
    const lines = output.split('\n').filter(Boolean)
    expect(lines).toHaveLength(4)
    expect(lines[0]!.split('\t')).toEqual([String(entries[0]!.date), '1234', 'Zygote', 'Verbose', 'verbose line'])
  })

  it('writes the device and entries for the json format', () => {
    const output = JSON.parse(formatLogs('serial-1', entries, 'json'))
    expect(output.deviceOS).toBe('Android')
    expect(output.serial).toBe('serial-1')
    expect(output.logs[3]).toEqual({
      date: entries[3]!.date
      , pid: 1234
      , tag: 'ActivityManager'
      , priorityLabel: 'Error'
      , message: 'error line'
    })
  })

  it('clamps the sample to the collected lines', () => {
    expect(JSON.parse(formatLogs('serial-1', entries.slice(0, 2), 'json', 4)).logs).toHaveLength(2)
    expect(formatLogs('serial-1', entries.slice(0, 2), 'log', 4).split('\n').filter(Boolean)).toHaveLength(2)
    expect(JSON.parse(formatLogs('serial-1', entries, 'json', 3)).logs).toHaveLength(3)
  })

  it('writes valid json without entries', () => {
    expect(JSON.parse(formatLogs('serial-1', [], 'json'))).toEqual({deviceOS: 'Android', serial: 'serial-1', logs: []})
    expect(formatLogs('serial-1', [], 'log')).toBe('')
  })

  it('names the file after the serial unless a name is given', () => {
    expect(logFileName('serial-1', '', 'json')).toBe('serial-1_logs.json')
    expect(logFileName('serial-1', 'my-logs', 'log')).toBe('my-logs.log')
  })
})
