import {gettext, translate} from './i18n'

const FIVE_MN = 300 * 1000
const ONE_HOUR = 3600 * 1000
const ONE_DAY = 24 * ONE_HOUR
const ONE_WEEK = 7 * ONE_DAY
const ONE_MONTH = 30 * ONE_DAY
const ONE_QUATER = 3 * ONE_MONTH
const ONE_HALF_YEAR = 6 * ONE_MONTH
const ONE_YEAR = 365 * ONE_DAY

export interface ClassOption {
  name: string
  id: string
  privilege: 'user' | 'admin'
  duration: number
}

export const classOptions: ClassOption[] = [
  {name: gettext('Once'), id: 'once', privilege: 'user', duration: Infinity}
  , {name: gettext('Hourly'), id: 'hourly', privilege: 'user', duration: ONE_HOUR}
  , {name: gettext('Daily'), id: 'daily', privilege: 'user', duration: ONE_DAY}
  , {name: gettext('Weekly'), id: 'weekly', privilege: 'user', duration: ONE_WEEK}
  , {name: gettext('Monthly'), id: 'monthly', privilege: 'user', duration: ONE_MONTH}
  , {name: gettext('Quaterly'), id: 'quaterly', privilege: 'user', duration: ONE_QUATER}
  , {name: gettext('Halfyearly'), id: 'halfyearly', privilege: 'user', duration: ONE_HALF_YEAR}
  , {name: gettext('Yearly'), id: 'yearly', privilege: 'user', duration: ONE_YEAR}
  , {name: gettext('Debug'), id: 'debug', privilege: 'admin', duration: FIVE_MN}
  , {name: gettext('Bookable'), id: 'bookable', privilege: 'admin', duration: Infinity}
  , {name: gettext('Standard'), id: 'standard', privilege: 'admin', duration: Infinity}
]

export function getClassName(id: string, language?: string): string {
  const option = classOptions.find((candidate) => candidate.id === id)
  return option ? translate(option.name, undefined, language) : ''
}

export function getClassDuration(id: string): number | '' {
  const option = classOptions.find((candidate) => candidate.id === id)
  return option ? option.duration : ''
}

export function getDuration(ms: number): string {
  if (ms < 1000) {
    return '0s'
  }
  let s = Math.floor(ms / 1000)
  let m = Math.floor(s / 60)
  s %= 60
  let h = Math.floor(m / 60)
  m %= 60
  const d = Math.floor(h / 24)
  h %= 24
  return [[d, 'd'], [h, 'h'], [m, 'm'], [s, 's']]
    .filter(([value]) => value !== 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ')
}
