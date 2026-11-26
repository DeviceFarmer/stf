import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useNavigate} from 'react-router'
import type {Control} from '@/core/control'
import {useUserDevices} from '@/core/devices/store'
import type {Device} from '@/core/devices/types'
import {kickDevice} from '@/core/group'
import {translate} from '@/core/i18n'
import {useStandalone} from '@/ui/modes'
import {notifyFailure} from '@/ui/notify'
import {rotateBy, rotationOf} from './device-commands'

export type Orientation = 'portrait' | 'landscape'

interface StreamRotation {
  angle: number | null
  ready: boolean
}

const ROTATION_SETTLE_MS = 400

function isPortrait(rotation: number | null): boolean {
  return rotation === 0 || rotation === 180
}

function isLandscape(rotation: number | null): boolean {
  return rotation === 90 || rotation === 270
}

function orientationOf(rotation: number | null): Orientation | null {
  if (isPortrait(rotation)) {
    return 'portrait'
  }
  if (isLandscape(rotation)) {
    return 'landscape'
  }
  return null
}

export function useDeviceActions(device: Device, control: Control, streamRotation?: StreamRotation) {
  const navigate = useNavigate()
  const standalone = useStandalone()
  const {devices: groupDevices} = useUserDevices()
  const deviceRef = useRef(device)
  const [currentRotation, setCurrentRotation] = useState<Orientation>('portrait')
  const deviceRotation = rotationOf(device)
  const rotation = streamRotation ? streamRotation.angle : deviceRotation
  const rotationDisabled = Boolean(streamRotation && !streamRotation.ready)

  useLayoutEffect(() => {
    deviceRef.current = device
  })

  useEffect(() => {
    const orientation = orientationOf(deviceRotation)
    if (orientation) {
      setCurrentRotation(orientation)
    }
  }, [deviceRotation])

  function tryToRotate(orientation: Orientation) {
    if (streamRotation) {
      if (!rotationDisabled) {
        control.rotate(orientation === 'portrait' ? 0 : 90)
      }
      return
    }
    setCurrentRotation(orientation)
    if (orientation === 'portrait') {
      control.rotate(0)
      window.setTimeout(() => {
        if (isLandscape(rotationOf(deviceRef.current))) {
          setCurrentRotation('landscape')
        }
      }, ROTATION_SETTLE_MS)
    }
    else {
      control.rotate(90)
      window.setTimeout(() => {
        if (isPortrait(rotationOf(deviceRef.current))) {
          setCurrentRotation('portrait')
        }
      }, ROTATION_SETTLE_MS)
    }
  }

  function kick(target: Device) {
    kickDevice(target).catch((error) => {
      notifyFailure(error, translate('Stop Using'))
    })
  }

  function controlDevice(target: Device) {
    navigate(`/control/${target.serial}`)
  }

  function stopUsing(target: Device) {
    if (control.readOnly && target.serial === device.serial) {
      return
    }
    if (target.serial !== device.serial) {
      kick(target)
      return
    }
    const next = groupDevices.length > 1 ?
      groupDevices.find((candidate) => candidate.serial !== device.serial) :
      undefined
    if (next) {
      controlDevice(next)
      kick(target)
    }
    else {
      kick(target)
      navigate('/devices')
    }
  }

  return {
    groupDevices
    , rotation
    , rotationDisabled
    , currentRotation: streamRotation ? orientationOf(rotation) : currentRotation
    , rotateBy: (delta: number) => {
      const source = streamRotation ? streamRotation.angle : rotationOf(deviceRef.current)
      if (!rotationDisabled && source !== null) {
        rotateBy(control, source, delta, standalone)
      }
    }
    , tryToRotate
    , stopUsing
    , controlDevice
  }
}

export type DeviceActions = ReturnType<typeof useDeviceActions>
