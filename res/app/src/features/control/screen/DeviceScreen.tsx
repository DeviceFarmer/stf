import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Button, Loader} from '@mantine/core'
import {IconEyeOff, IconRefresh} from '@tabler/icons-react'
import debounce from 'lodash/debounce'
import type {Control} from '@/core/control'
import {isAutomated} from '@/core/devices/enhance'
import type {Device} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {scalingCoordinator} from '@/core/scaling'
import {NothingToShow} from '@/ui/NothingToShow'
import {bindScreenKeyboard} from './screen-keyboard'
import {startScreenStream, type DisplayError, type ScreenGeometry, type ScreenStream,
  type ScreenStreamStatus} from './screen-stream'
import {bindScreenTouch} from './screen-touch'
import {useGuestOrientation} from './use-guest-orientation'
import './DeviceScreen.css'

const FINGER_COUNT = 10
const BOUNDS_DEBOUNCE_MS = 1000
const fingerIndexes = Array.from({length: FINGER_COUNT}, (_, index) => index)

export interface DeviceScreenProps {
  device: Device
  control: Control
  showScreen: boolean
}

export function DeviceScreen({device, control, showScreen}: DeviceScreenProps) {
  const {t} = useTranslation()
  const streamStatusMessages = {
    reconnecting: t('Reconnecting…')
    , offline: t('Device offline')
    , disconnected: t('Screen disconnected')
  }
  const displayErrorMessages = {
    secure: t('The current view is marked secure and cannot be viewed remotely.')
    , 'hevc-unsupported': t('This browser cannot decode the iPhone screen.')
    , 'hevc-insecure': t('The iPhone screen requires HTTPS or localhost.')
    , 'coredevice-unsupported': t('The iPhone screen requires iOS 27 or later and a compatible connection.')
    , 'hevc-unavailable': t('The iPhone screen could not be opened.')
    , 'hevc-locked': t('The iPhone is still locked. Unlock it on the device.')
    , 'hevc-automation': t('The iPhone screen is unavailable during automation.')
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const positionerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fingerRefs = useRef<HTMLSpanElement[]>([])
  const streamRef = useRef<ScreenStream | null>(null)
  const deviceRef = useRef(device)
  const showScreenRef = useRef(showScreen)
  const readOnlyRef = useRef(control.readOnly)
  const screenRef = useRef<ScreenGeometry>({rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}})
  const [displayError, setDisplayError] = useState<DisplayError>(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [iosScreenSessionId, setIosScreenSessionId] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState<ScreenStreamStatus>(null)

  const readOnly = control.readOnly
  const singleTouch = device.platform === 'iOS'
  const touchEnabled = !readOnly && (!singleTouch ||
    (showScreen && iosScreenSessionId !== null && device.using &&
      !isAutomated(device) && device.ios?.locked !== true))
  const url = device.display?.url
  const displayWidth = device.display?.width || 0
  const displayHeight = device.display?.height || 0
  const scaler = useMemo(
    () => scalingCoordinator(displayWidth, displayHeight)
    , [displayWidth, displayHeight]
  )

  useLayoutEffect(() => {
    deviceRef.current = device
    showScreenRef.current = showScreen
    readOnlyRef.current = readOnly
  })

  useEffect(() => {
    const root = rootRef.current
    const positioner = positionerRef.current
    const canvas = canvasRef.current
    if (!url || !root || !positioner || !canvas) {
      return undefined
    }

    const stream = startScreenStream({
      url
      , root
      , positioner
      , canvas
      , screen: screenRef.current
      , getDevice: () => deviceRef.current
      , isShown: () => showScreenRef.current
      , canControl: () => !readOnlyRef.current
      , onDisplayError: setDisplayError
      , onFirstFrame: () => setHasFrame(true)
      , onInputReady: setIosScreenSessionId
      , onStatusChange: setStreamStatus
    })
    streamRef.current = stream

    const debouncedCheck = debounce(() => stream.checkEnabled(), BOUNDS_DEBOUNCE_MS)
    const observer = new ResizeObserver(() => {
      stream.resize()
      debouncedCheck()
    })
    observer.observe(root)

    function visibilityListener() {
      stream.checkEnabled()
    }
    document.addEventListener('visibilitychange', visibilityListener, false)

    return () => {
      observer.disconnect()
      debouncedCheck.cancel()
      document.removeEventListener('visibilitychange', visibilityListener, false)
      stream.stop()
      streamRef.current = null
      root.classList.remove('has-frame')
      setHasFrame(false)
      setStreamStatus(null)
      setDisplayError(false)
    }
  }, [url])

  useEffect(() => {
    streamRef.current?.checkEnabled()
  }, [device.using, device.usage, device.owner?.email, device.present, device.ready, device.status
    , device.ios?.locked, readOnly, showScreen, url])

  useEffect(() => {
    const root = rootRef.current
    const input = inputRef.current
    if (!touchEnabled || !root || !input) {
      return undefined
    }
    return bindScreenTouch({
      root
      , input
      , fingers: fingerRefs.current
      , screen: screenRef.current
      , scaler
      , control
      , singleTouch
      , screenSessionId: iosScreenSessionId
    })
  }, [control, touchEnabled, scaler, singleTouch, iosScreenSessionId])

  useEffect(() => {
    const input = inputRef.current
    return !control.readOnly && input ? bindScreenKeyboard(input, control) : undefined
  }, [control, readOnly])

  useGuestOrientation(control, control.readOnly)

  function retryLoadingScreen() {
    if (displayError === 'secure') {
      control.home()
    }
    else {
      streamRef.current?.retry()
    }
  }

  return (
    <div ref={rootRef} className='device-screen'>
      <div ref={positionerRef} className='positioner'>
        <canvas ref={canvasRef} className='screen' />
        <canvas className='hacky-stretcher' width={1} height={1} />
      </div>
      {!hasFrame && showScreen && !displayError && !streamStatus && (
        <div className='screen-placeholder'>
          <Loader color='gray' type='dots' />
        </div>
      )}
      {!showScreen && (
        <div className='screen-placeholder'>
          <IconEyeOff size={40} stroke={1.3} />
        </div>
      )}
      {showScreen && streamStatus && !displayError && (
        <div className='screen-error screen-stream-status' role='status'>
          <div className='screen-error-message'>
            {streamStatus === 'reconnecting' ? <Loader color='gray' type='dots' /> : <IconEyeOff size={30} />}
            <p>{streamStatusMessages[streamStatus]}</p>
          </div>
        </div>
      )}
      {fingerIndexes.map((index) => (
        <span
          key={index}
          ref={(element) => {
            if (element) {
              fingerRefs.current[index] = element
            }
          }}
          className={`finger finger-${index}`}
        />
      ))}
      {showScreen && displayError && (
        <div className='screen-error' role='alert'>
          <div className='screen-error-message'>
            <NothingToShow message={t('No device screen')} icon={<IconEyeOff size={30} />} />
            <div className='screen-error-alert'>{displayErrorMessages[displayError]}</div>
            {(displayError === 'secure' || displayError === 'hevc-unavailable') && (
              <Button disabled={displayError === 'secure' && readOnly} fullWidth leftSection={<IconRefresh size={16} />}
                onClick={retryLoadingScreen}>
                {t('Retry')}
              </Button>
            )}
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type='password'
        className='stf-screen-keyboard'
        disabled={control.readOnly}
        tabIndex={control.readOnly ? -1 : 40}
        accessKey='C'
        autoCorrect='off'
        autoCapitalize='off'
        autoComplete='off'
        aria-label={t('Keyboard')}
      />
    </div>
  )
}
