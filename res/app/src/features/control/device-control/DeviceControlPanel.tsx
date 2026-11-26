import {useCallback, useEffect, useRef, useState, type DragEvent} from 'react'
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
import type {AndroidDisplayState, FoldSwitchScreen} from '../screen/screen-stream'
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

const FOLD_FRAME_TIMEOUT_MS = 5000

interface PostureRequest {
  control: PaneProps['control']
  mode: Fold4PostureMode
  expectedRevision?: string
  timer?: ReturnType<typeof setTimeout>
}

export default function DeviceControlPanel({device, control, standalone}: PaneProps & {standalone?: boolean}) {
  const {t} = useTranslation()
  const [showScreen, setShowScreen] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [androidDisplay, setAndroidDisplay] = useState<AndroidDisplayState | null>(null)
  const [androidInputRevision, setAndroidInputRevision] = useState<string | null>(null)
  const [streamRotationSupported, setStreamRotationSupported] = useState(false)
  const [postureRequest, setPostureRequest] = useState<PostureRequest | null>(null)
  const activeRequest = useRef(postureRequest)
  const foldSwitchRef = useRef<FoldSwitchScreen>(null)
  const ios = device.platform === 'iOS'
  const posturePending = postureRequest?.control === control
  const postureReady = androidInputRevision === androidDisplay?.selected.revision
  const actions = useDeviceActions(device, control, !ios && streamRotationSupported ? {
    angle: androidDisplay?.selected.rotation ?? null
  , ready: showScreen && postureReady && !posturePending
  } : undefined)
  const finishPostureRequest = useCallback(() => {
    clearTimeout(activeRequest.current?.timer)
    activeRequest.current = null
    setPostureRequest(null)
  }, [])
  const updateAndroidDisplay = useCallback((state: AndroidDisplayState | null) => {
    setAndroidDisplay(state)
    if (state?.posture || state?.projection) {
      setStreamRotationSupported(true)
    }
    if (!state) {
      setAndroidInputRevision(null)
      finishPostureRequest()
    }
  }, [finishPostureRequest])
  const updateAndroidInput = useCallback((revision: string | null) => {
    setAndroidInputRevision(revision)
    if (revision && activeRequest.current?.expectedRevision === revision) {
      finishPostureRequest()
    }
  }, [finishPostureRequest])

  useEffect(() => () => {
    clearTimeout(activeRequest.current?.timer)
    activeRequest.current = null
  }, [])

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
    if (!posture || posture === mode || !postureReady || activeRequest.current ||
      control.readOnly || !foldSwitchRef.current?.prepareFoldSwitch()) {
      return
    }
    const request: PostureRequest = {control, mode}
    const {revision} = androidDisplay.selected
    activeRequest.current = request
    setPostureRequest(request)
    try {
      const result = await control.setFold4Posture(mode, revision)
      if (activeRequest.current !== request) {
        return
      }
      const expected = result.body?.revision
      if (result.body?.mode !== mode || typeof expected !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(expected)) {
        throw new Error('Fold4 posture response did not confirm the screen revision')
      }
      request.expectedRevision = expected
      request.timer = setTimeout(() => {
        if (activeRequest.current === request) {
          finishPostureRequest()
          foldSwitchRef.current?.cancelFoldSwitch()
          notifyFailure(new Error('Fold4 screen did not become ready'), t('Foldable posture'))
        }
      }, FOLD_FRAME_TIMEOUT_MS)
      foldSwitchRef.current?.acceptFoldSwitch(expected)
    }
    catch (error) {
      if (activeRequest.current === request) {
        finishPostureRequest()
        foldSwitchRef.current?.cancelFoldSwitch()
        notifyFailure(error, t('Foldable posture'))
      }
    }
  }

  const postureOptions: {mode: Fold4PostureMode, label: string}[] = [
    {mode: 'folded', label: t('Fold')}
    , {mode: 'unfolded', label: t('Unfold')}
    , {mode: 'sensor', label: t('Follow hinge')}
  ]
  const postureButtons = !ios && showScreen && androidDisplay?.posture && (
    <div className={classes.postureControls} role='group' aria-label={t('Foldable posture')} aria-busy={posturePending}>
      <Button.Group>
        {postureOptions.map(({mode, label}) => {
          const selected = mode === androidDisplay.posture
          return (
            <Button
              key={mode}
              className={classes.postureButton}
              size='xs'
              variant={selected ? 'filled' : 'default'}
              aria-pressed={selected}
              data-pending={posturePending && !selected && postureRequest?.mode === mode ? true : undefined}
              disabled={control.readOnly || posturePending || !postureReady}
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
    <DeviceContextMenu device={device} control={control} rotationActions={actions}
      onStopUsing={() => actions.stopUsing(device)}>
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
          onAndroidInputReady={updateAndroidInput}
          onFoldSwitchInterrupted={finishPostureRequest}
          foldSwitchRef={foldSwitchRef}
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
