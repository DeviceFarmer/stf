import {useEffect, useEffectEvent, useState, useSyncExternalStore} from 'react'
import {api} from '../api'
import {mergeObject} from '../collection'
import {emit, onSocket} from '../socket'
import {enhanceDevice} from './enhance'
import type {Device} from './types'

type Filter = (device: Device) => boolean

interface DeviceEvent {
  important?: boolean
  data: Partial<Device> & {serial: string}
}

interface GroupDevicesEvent {
  important?: boolean
  devices: string[]
}

function merged(device: Device, data: Partial<Device>): Device {
  return enhanceDevice(mergeObject(device, data))
}

export async function loadDevice(serial: string): Promise<Device> {
  const response = await api.get<{device: Device}>(`/api/v1/devices/${serial}`)
  return response.device
}

export async function loadDevices(url: string): Promise<Device[]> {
  const response = await api.get<{devices: Device[]}>(url)
  return response.devices || []
}

const pendingDeviceLoads = new Map<string, Promise<Device | null>>()

function loadDeviceShared(serial: string): Promise<Device | null> {
  let pending = pendingDeviceLoads.get(serial)
  if (!pending) {
    pending = loadDevice(serial)
      .catch(() => null)
      .finally(() => pendingDeviceLoads.delete(serial))
    pendingDeviceLoads.set(serial, pending)
  }
  return pending
}

export function updateDeviceNote(serial: string, note: string): void {
  emit('device.note', {serial, note})
}

export class DeviceTracker {
  private devices: Device[] = []
  private bySerial = new Map<string, number>()
  private snapshot: Device[] = []
  private listeners = new Set<() => void>()
  private unsubscribers: Array<() => void> = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private frame: number | null = null
  private lastFlush = 0

  constructor(private filter: Filter, private serial?: string) {
    this.unsubscribers.push(
      onSocket('device.add', (event: DeviceEvent) => this.onAdd(event))
      , onSocket('device.remove', (event: DeviceEvent) => this.onChange(event))
      , onSocket('device.change', (event: DeviceEvent) => this.onChange(event))
      , onSocket('device.addGroupDevices', (event: GroupDevicesEvent) =>
        this.onAddGroupDevices(event))
      , onSocket('device.removeGroupDevices', (event: GroupDevicesEvent) =>
        this.onRemoveGroupDevices(event))
      , onSocket('device.updateGroupDevice', (event: DeviceEvent) => this.onUpdate(event))
    )
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): Device[] => this.snapshot

  get(serial: string): Device | undefined {
    const index = this.bySerial.get(serial)
    return index === undefined ? undefined : this.devices[index]
  }

  add(device: Device): void {
    this.onAdd({important: true, data: device})
  }

  destroy(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    if (this.timer) {
      clearTimeout(this.timer)
    }
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame)
    }
    this.listeners.clear()
  }

  private flush = () => {
    this.timer = null
    this.frame = null
    this.lastFlush = Date.now()
    this.snapshot = this.devices.slice()
    this.listeners.forEach((listener) => listener())
  }

  private notify(important?: boolean) {
    if (important) {
      if (this.frame === null) {
        this.frame = requestAnimationFrame(this.flush)
      }
      return
    }
    if (this.timer || this.frame !== null) {
      return
    }
    const delta = Date.now() - this.lastFlush
    if (delta > 1000) {
      this.frame = requestAnimationFrame(this.flush)
    }
    else {
      this.timer = setTimeout(this.flush, 1000 - delta)
    }
  }

  private insert(device: Device) {
    this.bySerial.set(device.serial, this.devices.push(device) - 1)
  }

  private build(data: Partial<Device>): Device {
    return enhanceDevice(mergeObject({}, data) as Device)
  }

  private replace(device: Device, data: Partial<Device>): Device {
    const next = merged(device, data)
    const index = this.bySerial.get(device.serial)
    if (index !== undefined) {
      this.devices[index] = next
    }
    return next
  }

  private remove(serial: string) {
    const index = this.bySerial.get(serial)
    if (index === undefined) {
      return
    }
    this.devices.splice(index, 1)
    this.bySerial.delete(serial)
    for (const [key, value] of this.bySerial) {
      if (value > index) {
        this.bySerial.set(key, value - 1)
      }
    }
  }

  private onChange(event: DeviceEvent) {
    const device = this.get(event.data.serial)
    if (!device) {
      return
    }
    if (event.data.likelyLeaveReason === 'status_change' &&
        device.statusTimeStamp && event.data.statusTimeStamp &&
        device.statusTimeStamp > event.data.statusTimeStamp) {
      return
    }
    const next = this.replace(device, event.data)
    if (!this.filter(next)) {
      this.remove(next.serial)
    }
    this.notify(event.important)
  }

  private onAdd(event: DeviceEvent) {
    const device = this.get(event.data.serial)
    if (device) {
      this.replace(device, event.data)
      this.notify(event.important)
      return
    }
    const built = this.build(event.data)
    if (this.filter(built)) {
      this.insert(built)
      this.notify(event.important)
    }
  }

  private onUpdate(event: DeviceEvent) {
    const device = this.get(event.data.serial)
    if (device) {
      this.replace(device, event.data)
      this.notify(event.important)
    }
  }

  private async onAddGroupDevices(event: GroupDevicesEvent) {
    const serials = this.serial ? event.devices.filter((serial) => serial === this.serial) : event.devices
    const devices = await Promise.all(serials.map(loadDeviceShared))
    for (const device of devices) {
      if (device && !this.bySerial.has(device.serial)) {
        this.insert(this.build(device))
        this.notify(event.important)
      }
    }
  }

  private onRemoveGroupDevices(event: GroupDevicesEvent) {
    for (const serial of event.devices) {
      if (this.bySerial.has(serial)) {
        this.remove(serial)
        this.notify(event.important)
      }
    }
  }
}

interface SharedTracker {
  tracker: DeviceTracker
  refs: number
  ready: Promise<void>
  loaded: boolean
  error: unknown
  keepAlive: boolean
  releaseTimer?: ReturnType<typeof setTimeout>
}

export const releaseGracePeriod = 10000

const shared = new Map<string, SharedTracker>()

interface TrackerOptions {
  serial?: string
  keepAlive?: boolean
}

function acquire(
  key: string
, filter: Filter
, load: () => Promise<Device[]>
, {serial, keepAlive = true}: TrackerOptions
): SharedTracker {
  let entry = shared.get(key)
  if (entry && entry.refs === 0) {
    clearTimeout(entry.releaseTimer)
    if (entry.error) {
      entry.tracker.destroy()
      entry = undefined
    }
  }
  if (!entry) {
    const tracker = new DeviceTracker(filter, serial)
    const created: SharedTracker = {
      tracker
      , refs: 0
      , loaded: false
      , error: null
      , keepAlive
      , ready: Promise.resolve()
    }
    created.ready = load()
      .then((devices) => {
        devices.forEach((device) => tracker.add(device))
      })
      .catch((error) => {
        created.error = error
      })
      .finally(() => {
        created.loaded = true
      })
    entry = created
    shared.set(key, entry)
  }
  entry.refs += 1
  return entry
}

function release(key: string): void {
  const entry = shared.get(key)
  if (!entry) {
    return
  }
  entry.refs -= 1
  if (entry.refs > 0) {
    return
  }
  const drop = () => {
    entry.tracker.destroy()
    shared.delete(key)
  }
  if (entry.keepAlive) {
    entry.releaseTimer = setTimeout(drop, releaseGracePeriod)
  }
  else {
    drop()
  }
}

const emptyDevices: Device[] = []
const emptySubscribe = () => () => undefined

export interface TrackedDevices {
  devices: Device[]
  loading: boolean
  error: unknown
}

function useTracker(
  key: string | null
, filter: Filter
, load: () => Promise<Device[]>
, options: TrackerOptions = {}
): TrackedDevices {
  const [entry, setEntry] = useState<SharedTracker | null>(null)
  const [loading, setLoading] = useState(true)
  const acquireTracker = useEffectEvent((trackerKey: string) => acquire(trackerKey, filter, load, options))

  useEffect(() => {
    if (!key) {
      return undefined
    }
    const acquired = acquireTracker(key)
    setEntry(acquired)
    setLoading(!acquired.loaded)
    let active = true
    acquired.ready.then(() => {
      if (active) {
        setLoading(false)
      }
    })
    return () => {
      active = false
      release(key)
    }
  }, [key])

  const devices = useSyncExternalStore(
    entry ? entry.tracker.subscribe : emptySubscribe
    , entry ? entry.tracker.getSnapshot : () => emptyDevices
  )

  return {devices, loading: !entry || loading, error: entry?.error ?? null}
}

export function useDevices(): TrackedDevices {
  return useTracker('all', () => true, () => loadDevices('/api/v1/devices'))
}

export function useUserDevices(): TrackedDevices {
  return useTracker(
    'user'
    , (device) => Boolean(device.using)
    , () => loadDevices('/api/v1/user/devices')
    , {keepAlive: false}
  )
}

export function useDevice(serial: string | undefined): {
  device: Device | undefined
  loading: boolean
  error: unknown
} {
  const {devices, loading, error} = useTracker(
    serial ? `serial:${serial}` : null
    , (device) => device.serial === serial
    , async() => (serial ? [await loadDevice(serial)] : [])
    , {serial}
  )
  return {device: devices[0], loading, error}
}
