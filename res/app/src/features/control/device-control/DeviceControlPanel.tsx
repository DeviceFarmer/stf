import {useCallback, useRef, useState, type DragEvent} from 'react'
import {Button} from '@mantine/core'
import {
  IconCircle
  , IconMenu2
  , IconSquare
  , IconTriangle
} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {notifyFailure} from '@/ui/notify'
import type {Fold4PostureMode} from '../../../../../../lib/types/android-display'
import {DeviceScreen} from '../screen/DeviceScreen'
import type {AndroidDisplayState} from '../screen/screen-stream'
import type {PaneProps} from '../types'
import {DeviceContextMenu} from './DeviceContextMenu'
import {DeviceControlKey} from './DeviceControlKey'
import {DeviceToolbar} from './DeviceToolbar'
import {installDroppedFiles} from './install-file'
import {useControlHotkeys} from './use-control-hotkeys'
import {useDeviceActions} from './use-device-actions'
import classes from './DeviceControlPanel.module.css'

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

export default function DeviceControlPanel({device, control, standalone}: PaneProps & {standalone?: boolean}) {
  const {t} = useTranslation()
  const [showScreen, setShowScreen] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [androidDisplay, setAndroidDisplay] = useState<AndroidDisplayState | null>(null)
  const [postureRequest, setPostureRequest] = useState<{control: PaneProps['control']} | null>(null)
  const activeRequest = useRef(postureRequest)
  const posturePending = postureRequest?.control === control
  const actions = useDeviceActions(device, control)
  const updateAndroidDisplay = useCallback((state: AndroidDisplayState | null) => {
    setAndroidDisplay(state)
    if (!state) {
      activeRequest.current = null
      setPostureRequest(null)
    }
  }, [])

  const ios = device.platform === 'iOS'
  useControlHotkeys(control, actions, ios, control.readOnly)

  function onDragOver(event: DragEvent) {
    if (!control.readOnly && hasFiles(event)) {
      event.preventDefault()
      setDragOver(true)
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragOver(false)
    if (control.readOnly) {
      return
    }
    const files = Array.from(event.dataTransfer.files)
    if (files.length) {
      installDroppedFiles(control, files)
    }
  }

  async function setFold4Posture(mode: Fold4PostureMode) {
    const posture = androidDisplay?.posture
    if (!posture || posture === mode || activeRequest.current?.control === control || control.readOnly) {
      return
    }
    const request = {control}
    const {revision} = androidDisplay.selected
    activeRequest.current = request
    setPostureRequest(request)
    try {
      await control.setFold4Posture(mode, revision)
    }
    catch (error) {
      if (activeRequest.current === request) {
        notifyFailure(error, t('Foldable posture'))
      }
    }
    finally {
      if (activeRequest.current === request) {
        activeRequest.current = null
        setPostureRequest(null)
      }
    }
  }

  const postureOptions: {mode: Fold4PostureMode, label: string}[] = [
    {mode: 'folded', label: t('Fold')}
    , {mode: 'unfolded', label: t('Unfold')}
    , {mode: 'sensor', label: t('Follow hinge')}
  ]
  const postureButtons = !ios && showScreen && androidDisplay?.posture && (
    <div role='group' aria-label={t('Foldable posture')}>
      <Button.Group>
        {postureOptions.map(({mode, label}) => {
          const selected = mode === androidDisplay.posture
          return (
            <Button
              key={mode}
              size='xs'
              variant={selected ? 'filled' : 'default'}
              aria-pressed={selected}
              disabled={control.readOnly || posturePending}
              onClick={() => setFold4Posture(mode)}
            >
              {label}
            </Button>
          )
        })}
      </Button.Group>
    </div>
  )

  const stage = (
    <DeviceContextMenu device={device} control={control} onStopUsing={() => actions.stopUsing(device)}>
      <div
        className={`${classes.stage} ${dragOver ? `${classes.dragover} dragover` : ''}`}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <DeviceScreen
          device={device}
          control={control}
          showScreen={showScreen}
          androidDisplay={androidDisplay}
          posturePending={posturePending}
          onAndroidDisplayChange={updateAndroidDisplay}
        />
      </div>
    </DeviceContextMenu>
  )

  if (standalone) {
    return (
      <div className={`${classes.panel} ${classes.standalone} interact-control stf-device-control`}>
        {stage}
      </div>
    )
  }

  return (
    <div className={`${classes.panel} interact-control stf-device-control`}>
      <DeviceToolbar
        device={device}
        actions={actions}
        readOnly={control.readOnly}
        showScreen={showScreen}
        postureButtons={postureButtons}
        onToggleScreen={() => setShowScreen((value) => !value)}
      />
      {stage}
      <div className={`${classes.bottom} stf-vnc-bottom`}>
        <div className={`${classes.navPill} controls`}>
          {!ios && <><DeviceControlKey control={control} deviceKey='menu' title={t('Menu')}>
            <IconMenu2 size={18} className={classes.navMenuKey} />
          </DeviceControlKey>
          <DeviceControlKey control={control} deviceKey='back' title={t('Back')}>
            <IconTriangle size={18} style={{transform: 'rotate(-90deg)'}} />
          </DeviceControlKey>
          </>}
          <DeviceControlKey control={control} deviceKey='home' title={t('Home')}>
            <IconCircle size={20} />
          </DeviceControlKey>
          {!ios && <DeviceControlKey control={control} deviceKey='app_switch' title={t('App switch')}>
            <IconSquare size={17} />
          </DeviceControlKey>}
        </div>
      </div>
    </div>
  )
}
