export interface LogcatMessage {
  serial: string
  date: number
  pid: number
  tid: number
  priority: number
  tag: string
  message: string
}

export interface LogEntry extends LogcatMessage {
  id: number
  dateLabel: string
  deviceLabel: string
  priorityLabel: string
}

export interface LogFilters {
  priority: number
  date: string
  pid: string
  tid: string
  tag: string
  message: string
}

export type LogExtension = 'json' | 'log'

export const logLevels = [
  'UNKNOWN'
  , 'DEFAULT'
  , 'VERBOSE'
  , 'DEBUG'
  , 'INFO'
  , 'WARN'
  , 'ERROR'
  , 'FATAL'
  , 'SILENT'
]

export const priorityLabels = logLevels.map((level) => level.charAt(0) + level.slice(1).toLowerCase())

export const levelNumbers = priorityLabels
  .map((name, number) => ({number, name}))
  .slice(2, 8)

export const defaultFilters: LogFilters = {
  priority: levelNumbers[0].number
  , date: ''
  , pid: ''
  , tid: ''
  , tag: ''
  , message: ''
}

export const logExtensions: LogExtension[] = ['json', 'log']

export const logMimeTypes: Record<LogExtension, string> = {
  json: 'application/json;charset=utf-8'
  , log: 'text/plain;charset=utf-8'
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

export function enhanceEntry(data: LogcatMessage, id: number): LogEntry {
  const date = new Date(data.date * 1000)
  return {
    ...data
    , id
    , dateLabel: `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}` +
      `.${pad(date.getMilliseconds(), 3)}`
    , deviceLabel: 'Android'
    , priorityLabel: priorityLabels[data.priority] || priorityLabels[0]
  }
}

type Matcher = (value: string) => boolean

export function stringMatcher(searchValue: string): Matcher {
  const content = searchValue.slice(1)
  switch (searchValue.charAt(0)) {
    case '/': {
      const lastSlash = content.lastIndexOf('/')
      if (lastSlash === -1) {
        return () => true
      }
      let regex: RegExp
      try {
        regex = new RegExp(content.substring(0, lastSlash), content.substring(lastSlash + 1))
      }
      catch {
        return () => true
      }
      return (value) => value.match(regex) !== null
    }
    case '!': {
      const excluded = content.toLowerCase()
      return (value) => value.toLowerCase().indexOf(excluded) === -1
    }
    default: {
      const included = searchValue.toLowerCase()
      return (value) => value.toLowerCase().indexOf(included) !== -1
    }
  }
}

export function sanitizePid(value: string): string {
  return value.replace(/[^0-9:]/g, '')
}

export function sanitizeTid(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

const datePattern = [
  '^(?:(?:([0-1]?\\d|2[0-3]):)?(:[0-5]\\d|[0-5]\\d):|\\d)'
  , '?(:[0-5]\\d|[0-5]\\d{1,2})?(\\.[0-9]?\\d{0,2}|:[0-5]?\\d{0,1})|(\\d{0,2})'
].join('')

export function isValidDateFilter(value: string): boolean {
  const matches = value.match(new RegExp(datePattern, 'g'))
  return Boolean(matches && matches.some((item) => item === value))
}

export function hasActiveFilters(filters: LogFilters, native: boolean): boolean {
  return filters.priority > defaultFilters.priority ||
    Boolean(filters.date || filters.message) ||
    (native && Boolean(filters.pid || filters.tid || filters.tag))
}

export function createEntryFilter(filters: LogFilters, native: boolean): (entry: LogEntry) => boolean {
  const checks: Array<(entry: LogEntry) => boolean> = []
  if (filters.priority > defaultFilters.priority) {
    checks.push((entry) => entry.priority >= filters.priority)
  }
  if (filters.date) {
    const matches = stringMatcher(filters.date)
    checks.push((entry) => matches(entry.dateLabel))
  }
  if (native && filters.pid) {
    const matches = stringMatcher(filters.pid)
    checks.push((entry) => matches(String(entry.pid)))
  }
  if (native && filters.tid) {
    const matches = stringMatcher(filters.tid)
    checks.push((entry) => matches(String(entry.tid)))
  }
  if (native && filters.tag) {
    const matches = stringMatcher(filters.tag)
    checks.push((entry) => matches(entry.tag))
  }
  if (filters.message) {
    const matches = stringMatcher(filters.message)
    checks.push((entry) => matches(entry.message))
  }
  return (entry) => checks.every((check) => check(entry))
}

export function filterEntries(entries: LogEntry[], filters: LogFilters, native: boolean): LogEntry[] {
  if (!hasActiveFilters(filters, native)) {
    return entries
  }
  return entries.filter(createEntryFilter(filters, native))
}

export function formatLogs(
  serial: string
, entries: LogEntry[]
, extension: LogExtension
, lineLimit = entries.length
): string {
  const lines = entries.slice(0, Math.min(lineLimit, entries.length))
  if (extension === 'log') {
    return lines
      .map((line) => [line.date, line.pid, line.tag, line.priorityLabel, line.message].join('\t') + '\n')
      .join('')
  }
  return JSON.stringify({
    deviceOS: lines.length ? lines[0].deviceLabel : 'Android'
    , serial: lines.length ? lines[0].serial : serial
    , logs: lines.map((line) => ({
      date: line.date
      , pid: line.pid
      , tag: line.tag
      , priorityLabel: line.priorityLabel
      , message: line.message
    }))
  })
}

export function logFileName(serial: string, fileName: string, extension: LogExtension): string {
  return `${fileName || `${serial}_logs`}.${extension}`
}
