import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Button, Loader} from '@mantine/core'
import {IconEyeOff, IconRefresh} from '@tabler/icons-react'
import debounce from 'lodash/debounce'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {scalingCoordinator} from '@/core/scaling'
import {NothingToShow} from '@/ui/NothingToShow'
import {bindScreenKeyboard} from './screen-keyboard'
import {startScreenStream, type DisplayError, type ScreenGeometry, type ScreenStream} from './screen-stream'
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
  const rootRef = useRef<HTMLDivElement>(null)
  const positionerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fingerRefs = useRef<HTMLSpanElement[]>([])
  const streamRef = useRef<ScreenStream | null>(null)
  const deviceRef = useRef(device)
  const showScreenRef = useRef(showScreen)
  const screenRef = useRef<ScreenGeometry>({rotation: 0, bounds: {x: 0, y: 0, w: 0, h: 0}})
  const [displayError, setDisplayError] = useState<DisplayError>(false)
  const [hasFrame, setHasFrame] = useState(false)

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
      , onDisplayError: setDisplayError
      , onFirstFrame: () => setHasFrame(true)
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
    }
  }, [url])

  useEffect(() => {
    streamRef.current?.checkEnabled()
  }, [device.using, showScreen, url])

  useEffect(() => {
    const root = rootRef.current
    const input = inputRef.current
    if (!root || !input) {
      return undefined
    }
    return bindScreenTouch({
      root
      , input
      , fingers: fingerRefs.current
      , screen: screenRef.current
      , scaler
      , control
    })
  }, [control, scaler])

  useEffect(() => {
    const input = inputRef.current
    return input ? bindScreenKeyboard(input, control) : undefined
  }, [control])

  useGuestOrientation(control)

  function retryLoadingScreen() {
    if (displayError === 'secure') {
      control.home()
    }
  }

  return (
    <div ref={rootRef} className='device-screen'>
      <div ref={positionerRef} className='positioner'>
        <canvas ref={canvasRef} className='screen' />
        <canvas className='hacky-stretcher' width={1} height={1} />
      </div>
      {!hasFrame && showScreen && !displayError && (
        <div className='screen-placeholder'>
          <Loader color='gray' type='dots' />
        </div>
      )}
      {!showScreen && (
        <div className='screen-placeholder'>
          <IconEyeOff size={40} stroke={1.3} />
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
      {displayError && (
        <div className='screen-error'>
          <div className='screen-error-message'>
            <NothingToShow message={t('No device screen')} icon={<IconEyeOff size={30} />} />
            {displayError === 'secure' && (
              <div className='screen-error-alert'>
                {t('The current view is marked secure and cannot be viewed remotely.')}
              </div>
            )}
            <Button fullWidth leftSection={<IconRefresh size={16} />} onClick={retryLoadingScreen}>
              {t('Retry')}
            </Button>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type='password'
        className='stf-screen-keyboard'
        tabIndex={40}
        accessKey='C'
        autoCorrect='off'
        autoCapitalize='off'
        autoComplete='off'
        aria-label={t('Keyboard')}
      />
    </div>
  )
}
