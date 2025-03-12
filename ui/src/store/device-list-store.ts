import { inject, injectable } from 'inversify'
import { makeAutoObservable } from 'mobx'

import { socket } from '@/api/socket'
import { ListDevice } from '@/types/list-device.type'
import { DeviceTableRow } from '@/types/device-table-row.type'

import { throttle } from '@/lib/utils/throttle.util'
import { queries } from '@/config/queries/query-key-store'
import { queryClient } from '@/config/queries/query-client'
import { DeviceState } from '@/types/enums/device-state.enum'
import { getDeviceState } from '@/lib/utils/get-device-state.util'
import { isDeviceUsable } from '@/lib/utils/is-device-usable.util'
import { CONTAINER_IDS } from '@/config/inversify/container-ids'

import type { Device } from '@/generated/types'
import type { QueryObserverResult } from '@tanstack/react-query'
import type { MobxQueryFactory } from '@/types/mobx-query-factory.type'
import type { DeviceChangeMessage } from '@/types/device-change-message.type'

@injectable()
export class DeviceListStore {
  private batchedUpdates: Record<string, Partial<Device>> = {}
  private throttleDelay = 200

  private devicesQuery

  private throttledFlushUpdates = throttle(this.flushUpdates, this.throttleDelay)

  constructor(@inject(CONTAINER_IDS.factoryMobxQuery) mobxQueryFactory: MobxQueryFactory) {
    makeAutoObservable(this)

    this.devicesQuery = mobxQueryFactory(() => ({ ...queries.devices.list, staleTime: Infinity }))

    this.flushUpdates = this.flushUpdates.bind(this)
    this.onDeviceChange = this.onDeviceChange.bind(this)

    this.addDeviceChangeListener()
  }

  addDeviceChangeListener(): void {
    socket.on('device.change', this.onDeviceChange)
  }

  removeDeviceChangeListener(): void {
    socket.off('device.change', this.onDeviceChange)
  }

  get devicesQueryResult(): QueryObserverResult<ListDevice[]> {
    return this.devicesQuery.result
  }

  get busyDevicesCount(): number | undefined {
    return this.devicesQuery.data?.reduce(
      (accumulator, item) => (getDeviceState(item) === DeviceState.BUSY ? accumulator + 1 : accumulator),
      0
    )
  }

  get totalNumberDevices(): number | undefined {
    return this.devicesQuery.data?.length
  }

  get usableDevicesCount(): number | undefined {
    return this.devicesQuery.data?.reduce(
      (accumulator, { present, status, ready, using, owner }) =>
        isDeviceUsable({ present, status, ready, using, hasOwner: !!owner }) ? accumulator + 1 : accumulator,
      0
    )
  }

  get usingDevicesCount(): number | undefined {
    return this.devicesQuery.data?.reduce((accumulator, item) => (item.using ? accumulator + 1 : accumulator), 0)
  }

  private async onDeviceChange({ data: changedData }: DeviceChangeMessage<Partial<Device>>): Promise<void> {
    if (changedData.serial) {
      this.batchedUpdates[changedData.serial] = changedData
    }

    this.throttledFlushUpdates()
  }

  private flushUpdates(): void {
    queryClient.setQueryData<DeviceTableRow[]>(queries.devices.list.queryKey, (oldData) => {
      if (!oldData) return []

      return oldData.map((item): DeviceTableRow => {
        const updateData = this.batchedUpdates[item.serial]

        if (updateData) {
          return { ...item, ...updateData, needUpdate: Date.now() }
        }

        return item
      })
    })

    this.batchedUpdates = {}
  }
}
