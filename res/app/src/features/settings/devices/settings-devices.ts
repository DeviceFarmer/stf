import {useMemo} from 'react'
import {listOf} from '@/core/collection'
import {devicesApi, deviceSettingsEvents} from '@/core/devices-api'
import {screenOf} from '../groups/rules'
import {deviceSettingsFields, type SettingsDevice} from '../groups/types'
import {useLiveCollection, type LiveCollectionSource} from '../use-live-collection'

const [createdEvent, deletedEvent, updatedEvent] = deviceSettingsEvents

function publishDevice(device: Record<string, any>): SettingsDevice {
  const published: Record<string, any> = {}
  for (const [key, value] of Object.entries(device)) {
    published[key] = value === null ? '' : value
  }
  if (published.model) {
    published.displayStr = screenOf(published as SettingsDevice)
  }
  else {
    published.display = {}
  }
  return published as SettingsDevice
}

const devicesSource: LiveCollectionSource<SettingsDevice> = {
  load: async() => {
    const response = await devicesApi.getDevices('user', deviceSettingsFields)
    return (response.devices || []).map((raw) => publishDevice(raw as unknown as Record<string, any>))
  }
  , keyOf: (device) => device.serial
  , itemOf: (message: {device: Record<string, any>}) => publishDevice(message.device)
  , events: {created: createdEvent, deleted: deletedEvent, updated: [updatedEvent]}
}

export function useSettingsDevices() {
  const {collection, loading, error} = useLiveCollection(devicesSource)
  const devices = useMemo(() => listOf(collection), [collection])
  return {devices, loading, error}
}
