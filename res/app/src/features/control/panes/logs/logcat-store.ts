import {create} from 'zustand'
import type {Control} from '@/core/control'
import {onSocket} from '@/core/socket'
import {
  defaultFilters
  , enhanceEntry
  , sanitizePid
  , sanitizeTid
  , type LogcatMessage
  , type LogEntry
  , type LogFilters
} from './logcat'

export const maxEntries = 3000
const flushDelay = 100

export interface DeviceLogs {
  entries: LogEntry[]
  started: boolean
  filters: LogFilters
}

interface LogcatState {
  devices: Record<string, DeviceLogs>
}

export const emptyDeviceLogs: DeviceLogs = {entries: [], started: false, filters: defaultFilters}

export const useLogcatStore = create<LogcatState>(() => ({devices: {}}))

export function useDeviceLogs(serial: string): DeviceLogs {
  return useLogcatStore((state) => state.devices[serial]) || emptyDeviceLogs
}

export function currentLogEntries(serial: string): LogEntry[] {
  return (useLogcatStore.getState().devices[serial] || emptyDeviceLogs).entries
}

function updateDevice(serial: string, update: (current: DeviceLogs) => Partial<DeviceLogs>): void {
  useLogcatStore.setState((state) => {
    const current = state.devices[serial] || emptyDeviceLogs
    return {devices: {...state.devices, [serial]: {...current, ...update(current)}}}
  })
}

let nextEntryId = 0
let pendingEntries: Record<string, LogEntry[]> = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null
const runningControls = new Map<string, Control>()

function flushEntries(): void {
  flushTimer = null
  const batch = pendingEntries
  pendingEntries = {}
  useLogcatStore.setState((state) => {
    const devices = {...state.devices}
    Object.keys(batch).forEach((serial) => {
      const current = devices[serial] || {...emptyDeviceLogs, started: true}
      const merged = current.entries.concat(batch[serial])
      devices[serial] = {
        ...current
        , entries: merged.length > maxEntries ? merged.slice(merged.length - maxEntries) : merged
      }
    })
    return {devices}
  })
}

onSocket('logcat.entry', (message: LogcatMessage) => {
  nextEntryId += 1
  const queue = pendingEntries[message.serial] || []
  queue.push(enhanceEntry(message, nextEntryId))
  pendingEntries[message.serial] = queue
  if (!flushTimer) {
    flushTimer = setTimeout(flushEntries, flushDelay)
  }
})

onSocket('device.change', (event: {data?: {serial?: string, using?: boolean}}) => {
  const serial = event.data?.serial
  if (serial && event.data?.using === false && useLogcatStore.getState().devices[serial]?.started) {
    runningControls.delete(serial)
    updateDevice(serial, () => ({started: false}))
  }
})

window.addEventListener('beforeunload', () => {
  runningControls.forEach((control) => {
    control.stopLogcat().catch(() => undefined)
  })
})

export async function startLogcat(serial: string, control: Control): Promise<void> {
  runningControls.set(serial, control)
  updateDevice(serial, () => ({started: true}))
  try {
    await control.startLogcat([])
  }
  catch (error) {
    runningControls.delete(serial)
    updateDevice(serial, () => ({started: false}))
    throw error
  }
}

export async function stopLogcat(serial: string, control: Control): Promise<void> {
  runningControls.delete(serial)
  updateDevice(serial, () => ({started: false}))
  await control.stopLogcat()
}

export function clearLogs(serial: string): void {
  delete pendingEntries[serial]
  updateDevice(serial, () => ({entries: []}))
}

export function setLogFilter<K extends keyof LogFilters>(serial: string, key: K, value: LogFilters[K]): void {
  let sanitized = value
  if (key === 'pid') {
    sanitized = sanitizePid(value as string) as LogFilters[K]
  }
  else if (key === 'tid') {
    sanitized = sanitizeTid(value as string) as LogFilters[K]
  }
  updateDevice(serial, (current) => ({filters: {...current.filters, [key]: sanitized}}))
}
