import {getSetting, useSetting} from './settings'

export const defaultDateFormat = 'M/d/yy h:mm:ss a'

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June'
  , 'July', 'August', 'September', 'October', 'November', 'December'
]
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const namedFormats: Record<string, string> = {
  medium: 'MMM d, y h:mm:ss a'
  , short: 'M/d/yy h:mm a'
  , fullDate: 'EEEE, MMMM d, y'
  , longDate: 'MMMM d, y'
  , mediumDate: 'MMM d, y'
  , shortDate: 'M/d/yy'
  , mediumTime: 'h:mm:ss a'
  , shortTime: 'h:mm a'
}

function pad(value: number, size: number, trim = false): string {
  const sign = value < 0 ? '-' : ''
  const digits = String(Math.abs(value)).padStart(size, '0')
  return sign + (trim ? digits.slice(-size) : digits)
}

function twelveHour(date: Date): number {
  return date.getHours() % 12 || 12
}

function weekOfYear(date: Date): number {
  const year = date.getFullYear()
  const firstDay = new Date(year, 0, 1).getDay()
  const firstThursday = new Date(year, 0, (firstDay <= 4 ? 5 : 12) - firstDay)
  const thisThursday = new Date(year, date.getMonth(), date.getDate() + (4 - date.getDay()))
  return 1 + Math.round((thisThursday.getTime() - firstThursday.getTime()) / 6.048e8)
}

function timezone(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  return sign + pad(Math.floor(absolute / 60), 2) + pad(absolute % 60, 2)
}

function era(date: Date, long: boolean): string {
  const bc = date.getFullYear() <= 0
  if (long) {
    return bc ? 'Before Christ' : 'Anno Domini'
  }
  return bc ? 'BC' : 'AD'
}

const tokens: Record<string, (date: Date) => string> = {
  yyyy: (date) => pad(date.getFullYear(), 4)
  , yy: (date) => pad(date.getFullYear(), 2, true)
  , y: (date) => pad(date.getFullYear(), 1)
  , MMMM: (date) => monthNames[date.getMonth()]
  , MMM: (date) => monthNames[date.getMonth()].slice(0, 3)
  , MM: (date) => pad(date.getMonth() + 1, 2)
  , M: (date) => String(date.getMonth() + 1)
  , LLLL: (date) => monthNames[date.getMonth()]
  , dd: (date) => pad(date.getDate(), 2)
  , d: (date) => String(date.getDate())
  , HH: (date) => pad(date.getHours(), 2)
  , H: (date) => String(date.getHours())
  , hh: (date) => pad(twelveHour(date), 2)
  , h: (date) => String(twelveHour(date))
  , mm: (date) => pad(date.getMinutes(), 2)
  , m: (date) => String(date.getMinutes())
  , ss: (date) => pad(date.getSeconds(), 2)
  , s: (date) => String(date.getSeconds())
  , sss: (date) => pad(date.getMilliseconds(), 3)
  , EEEE: (date) => dayNames[date.getDay()]
  , EEE: (date) => dayNames[date.getDay()].slice(0, 3)
  , a: (date) => (date.getHours() < 12 ? 'AM' : 'PM')
  , Z: timezone
  , ww: (date) => pad(weekOfYear(date), 2)
  , w: (date) => String(weekOfYear(date))
  , G: (date) => era(date, false)
  , GG: (date) => era(date, false)
  , GGG: (date) => era(date, false)
  , GGGG: (date) => era(date, true)
}

const tokenPattern = /E+|y+|M+|L+|d+|H+|h+|m+|s+|a|Z|G+|w+|'(?:[^']|'')*'|[^yMLdHhmsaZEwG']+/g

export function formatDate(value: string | number | Date | undefined | null, format?: string): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  const named = format && Object.hasOwn(namedFormats, format) ? namedFormats[format] : format
  const pattern = named || namedFormats.mediumDate
  return (pattern.match(tokenPattern) || []).map((part) => {
    const token = tokens[part]
    if (token) {
      return token(date)
    }
    if (part === '\'\'') {
      return '\''
    }
    return part.replace(/(^'|'$)/g, '').replace(/''/g, '\'')
  }).join('')
}

export function toDatetimeLocal(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}` +
    `T${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}`
}

export function fromDatetimeLocal(value: string): Date {
  return value ? new Date(value) : new Date(NaN)
}

export function getDateFormat(): string {
  return getSetting<string>('dateFormat', defaultDateFormat)
}

export function useDateFormat(): string {
  return useSetting<string>('dateFormat', defaultDateFormat)[0]
}
