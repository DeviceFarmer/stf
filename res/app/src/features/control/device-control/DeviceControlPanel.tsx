import {useState, type DragEvent} from 'react'
import {
  IconCircle
  , IconMenu2
  , IconSquare
  , IconTriangle
} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {DeviceScreen} from '../screen/DeviceScreen'
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
  const actions = useDeviceActions(device, control)

  useControlHotkeys(control, actions)

  function onDragOver(event: DragEvent) {
    if (hasFiles(event)) {
      event.preventDefault()
      setDragOver(true)
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length) {
      installDroppedFiles(control, files)
    }
  }

  const stage = (
    <DeviceContextMenu device={device} control={control} onStopUsing={() => actions.stopUsing(device)}>
      <div
        className={`${classes.stage} ${dragOver ? `${classes.dragover} dragover` : ''}`}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <DeviceScreen device={device} control={control} showScreen={showScreen} />
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
        showScreen={showScreen}
        onToggleScreen={() => setShowScreen((value) => !value)}
      />
      {stage}
      <div className={`${classes.bottom} stf-vnc-bottom`}>
        <div className={`${classes.navPill} controls`}>
          <DeviceControlKey control={control} deviceKey='menu' title={t('Menu')}>
            <IconMenu2 size={18} className={classes.navMenuKey} />
          </DeviceControlKey>
          <DeviceControlKey control={control} deviceKey='back' title={t('Back')}>
            <IconTriangle size={18} style={{transform: 'rotate(-90deg)'}} />
          </DeviceControlKey>
          <DeviceControlKey control={control} deviceKey='home' title={t('Home')}>
            <IconCircle size={20} />
          </DeviceControlKey>
          <DeviceControlKey control={control} deviceKey='app_switch' title={t('App switch')}>
            <IconSquare size={17} />
          </DeviceControlKey>
        </div>
      </div>
    </div>
  )
}
