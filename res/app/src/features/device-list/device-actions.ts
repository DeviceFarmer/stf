import {useMemo, type MouseEvent} from 'react'
import {useNavigate} from 'react-router'
import type {Device} from '@/core/devices/types'
import {inviteDevice, kickDevice} from '@/core/group'
import {useTranslation} from '@/core/i18n'
import {useAdminMode} from '@/ui/modes'
import {notifyFailure} from '@/ui/notify'
import {openStandalone} from './standalone'

export interface DeviceActions {
  adminMode: boolean
  open: (event: MouseEvent, device: Device) => Promise<void> | undefined
  status: (event: MouseEvent, device: Device) => Promise<void> | undefined
  stop: (device: Device) => Promise<void>
}

export function controlHref(device: Device): string {
  return `#/control/${device.serial}`
}

export function canStartUsing(device: Device): boolean {
  return Boolean(device.usable && !device.using)
}

export function useDeviceActions(): DeviceActions {
  const navigate = useNavigate()
  const {t} = useTranslation()
  const [adminMode] = useAdminMode()

  return useMemo(() => {
    function fail(error: unknown) {
      notifyFailure(error, t('Error'))
    }

    function kick(device: Device, force = false): Promise<void> {
      return kickDevice(device, force)
        .then(() => undefined)
        .catch(() => fail(t('Device cannot get kicked from the group')))
    }

    function invite(device: Device): Promise<void> {
      return inviteDevice(device)
        .then(() => undefined)
        .catch(fail)
    }

    function startUsing(device: Device): Promise<void> {
      return inviteDevice(device)
        .then(() => {
          navigate(`/control/${device.serial}`)
        })
        .catch(fail)
    }

    function modified(event: MouseEvent, device: Device): Promise<void> | undefined {
      if (device.state !== 'available') {
        return undefined
      }
      if (event.altKey) {
        event.preventDefault()
        return invite(device)
      }
      if (event.shiftKey) {
        event.preventDefault()
        openStandalone(device)
        return Promise.resolve()
      }
      return undefined
    }

    return {
      adminMode
      , open(event, device) {
        const handled = modified(event, device)
        if (handled || event.metaKey || event.ctrlKey || event.button !== 0) {
          return handled
        }
        if (canStartUsing(device)) {
          event.preventDefault()
          return startUsing(device)
        }
        return undefined
      }
      , status(event, device) {
        const handled = modified(event, device)
        if (handled) {
          return handled
        }
        if (adminMode && device.state === 'busy') {
          return kick(device, true)
        }
        if (device.using) {
          return kick(device)
        }
        if (canStartUsing(device)) {
          return startUsing(device)
        }
        return undefined
      }
      , stop: (device) => kick(device)
    }
  }, [navigate, t, adminMode])
}
