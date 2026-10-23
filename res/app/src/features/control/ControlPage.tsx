import {lazy, Suspense, useEffect, useEffectEvent, useMemo, useRef, useState, type ComponentType} from 'react'
import {useNavigate, useParams} from 'react-router'
import {
  Alert
  , Box
  , Button
  , Center
  , Group
  , Loader
  , Modal
  , ScrollArea
  , Stack
  , Tabs
  , Text
  , Title
} from '@mantine/core'
import {
  IconBolt
  , IconCamera
  , IconFolderOpen
  , IconGauge
  , IconInfoCircle
  , IconListDetails
  , IconRefresh
  , IconRoute
  , IconSitemap
} from '@tabler/icons-react'
import {createControl, type Control} from '@/core/control'
import {useDevice} from '@/core/devices/store'
import {isAutomated, likelyLeaveReason} from '@/core/devices/enhance'
import type {Device} from '@/core/devices/types'
import {inviteDevice} from '@/core/group'
import {gettext, useTranslation} from '@/core/i18n'
import {setSetting, useSetting} from '@/core/settings'
import {basicMode, useStandalone} from '@/ui/modes'
import {usePageTitle} from '@/ui/page-title'
import {stateColor} from '@/ui/device-state'
import {DeviceImage} from '@/ui/DeviceImage'
import {ControlRedirect} from './ControlRedirect'
import DeviceControlPanel from './device-control/DeviceControlPanel'
import type {PaneProps} from './types'
import classes from './ControlPage.module.css'

interface PaneDefinition {
  id: string
  title: string
  icon: ComponentType<{size?: number}>
  component: ComponentType<PaneProps>
  fill?: boolean
}

export const panes: PaneDefinition[] = [
  {
    id: 'dashboard'
    , title: gettext('Dashboard')
    , icon: IconGauge
    , component: lazy(() => import('./panes/dashboard/DashboardPane'))
  }
  , {
    id: 'logs'
    , title: gettext('Logs')
    , icon: IconListDetails
    , component: lazy(() => import('./panes/logs/LogsPane'))
    , fill: true
  }
  , {
    id: 'screenshots'
    , title: gettext('Screenshots')
    , icon: IconCamera
    , component: lazy(() => import('./panes/screenshots/ScreenshotsPane'))
  }
  , {
    id: 'automation'
    , title: gettext('Automation')
    , icon: IconRoute
    , component: lazy(() => import('./panes/automation/AutomationPane'))
  }
  , {
    id: 'advanced'
    , title: gettext('Advanced')
    , icon: IconBolt
    , component: lazy(() => import('./panes/advanced/AdvancedPane'))
  }
  , {
    id: 'explorer'
    , title: gettext('File Explorer')
    , icon: IconFolderOpen
    , component: lazy(() => import('./panes/explorer/ExplorerPane'))
  }
  , {
    id: 'info'
    , title: gettext('Info')
    , icon: IconInfoCircle
    , component: lazy(() => import('./panes/info/InfoPane'))
  }
]

function DeviceLostModal({device, onReconnect, onLeave, onDismiss}: {
  device: Device
  onReconnect: () => void
  onLeave: () => void
  onDismiss: () => void
}) {
  const {t} = useTranslation()
  return (
    <Modal
      opened
      onClose={onDismiss}
      centered
      title={<Text fw={600} c='red'>{t('Device was disconnected')}</Text>}
    >
      <Stack align='center' gap='sm' className='stf-fatal-message'>
        <Text fw={500} ta='center'>{likelyLeaveReason(device.likelyLeaveReason)}</Text>
        <DeviceImage src={device.enhancedImage120} w={96} h={96} alt='' />
        <Text fw={600}>{device.enhancedName}</Text>
        <Text c={stateColor(device.state)} fw={500}>{t(device.enhancedStatePassive)}</Text>
        <Group justify='space-between' w='100%' mt='md'>
          <Button leftSection={<IconRefresh size={16} />} onClick={onReconnect}>
            {t('Try to reconnect')}
          </Button>
          <Button variant='default' leftSection={<IconSitemap size={16} />} onClick={onLeave}>
            {t('Go to Device List')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function useSplit(initial: number) {
  const [width, setWidth] = useState(initial)
  const dragging = useRef(false)

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (dragging.current) {
        setWidth(Math.min(Math.max(event.clientX, 240), window.innerWidth - 320))
      }
    }
    function onUp() {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  return {
    width
    , startDrag: () => {
      dragging.current = true
      document.body.style.cursor = 'col-resize'
    }
  }
}

function ControlWorkspace({device, control}: PaneProps) {
  const {t} = useTranslation()
  const [activePane, setActivePane] = useSetting<string>('controlActivePane', 'dashboard')
  const split = useSplit(Math.round(window.innerWidth * 0.34))
  const visiblePanes = device.platform === 'iOS' ?
    panes.filter(pane => ['dashboard', 'screenshots', 'info'].includes(pane.id)) : panes
  const selectedPane = visiblePanes.some((pane) => pane.id === activePane) ? activePane : 'dashboard'
  const current = control.readOnly ? 'info' : selectedPane

  return (
    <div className={classes.workspace}>
      <div className={classes.screen} style={{width: split.width}}>
        <DeviceControlPanel device={device} control={control} />
      </div>
      <div
        className={classes.handle}
        onPointerDown={split.startDrag}
        role='separator'
        aria-orientation='vertical'
      />
      <Tabs
        value={current}
        onChange={(value) => value && setActivePane(value)}
        keepMounted={false}
        className={classes.tabs}
        variant='outline'
      >
        <Tabs.List className={classes.tabList}>
          {visiblePanes.map(({id, title, icon: Icon}) => (
            <Tabs.Tab key={id} value={id} disabled={control.readOnly && id !== 'info'} leftSection={<Icon size={16} />}>
              {t(title)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {visiblePanes.map(({id, component: Pane, fill}) => {
          const content = (
            <Suspense fallback={<Center p='xl'><Loader /></Center>}>
              <Pane device={device} control={control} />
            </Suspense>
          )
          return (
            <Tabs.Panel key={id} value={id} className={classes.panel}>
              {fill ?
                <Box p='md' className={classes.fill}>{content}</Box> :
                <ScrollArea h='100%' type='auto'>
                  <Box p='md'>{content}</Box>
                </ScrollArea>}
            </Tabs.Panel>
          )
        })}
      </Tabs>
    </div>
  )
}

export default function ControlPage() {
  const {serial} = useParams()
  return <ControlSession key={serial} />
}

function ControlSession() {
  const {serial} = useParams()
  const navigate = useNavigate()
  const {t} = useTranslation()
  const standalone = useStandalone()
  const {device, loading, error} = useDevice(serial)
  const [joined, setJoined] = useState<Device | null>(null)
  const [lost, setLost] = useState(false)
  const [watching, setWatching] = useState(false)
  const previousState = useRef<string | null>(null)
  const loadedSerial = device?.serial
  const deviceState = device?.state
  const latestDevice = useEffectEvent(() => device)
  const leaveToDeviceList = useEffectEvent(() => navigate('/', {replace: true}))

  usePageTitle(joined ? device?.enhancedName || joined.enhancedName : null)

  useEffect(() => {
    if (error) {
      navigate('/', {replace: true})
    }
  }, [error, navigate])

  useEffect(() => {
    const target = latestDevice()
    if (!target || joined) {
      return
    }
    if (isAutomated(target)) {
      setWatching(true)
      setJoined(target)
      setSetting('lastUsedDevice', target.serial)
      return
    }
    let active = true
    inviteDevice(target)
      .then(() => {
        if (active) {
          setJoined(target)
          setSetting('lastUsedDevice', target.serial)
        }
      })
      .catch(() => {
        if (active) {
          leaveToDeviceList()
        }
      })
    return () => {
      active = false
    }
  }, [loadedSerial, joined])

  useEffect(() => {
    if (device && isAutomated(device)) {
      setWatching(true)
    }
  }, [device, deviceState])

  useEffect(() => {
    if (!deviceState || !joined) {
      return
    }
    const previous = previousState.current
    previousState.current = deviceState
    if (!watching && deviceState !== 'automation' && previous && previous !== deviceState &&
        previous === 'using') {
      setLost(true)
    }
  }, [deviceState, joined, watching])

  const readOnly = watching || !device?.using || Boolean(device && isAutomated(device))
  const control: Control | null = useMemo(
    () => (joined ? createControl(joined, joined.channel, () => readOnly) : null)
    , [joined, readOnly]
  )

  if (!serial) {
    return <ControlRedirect />
  }

  if (loading || !device || !joined || !control) {
    return (
      <Center className='fill-height'>
        <Stack align='center' gap='xs'>
          <Loader />
          <Title order={5} c='dimmed'>{t('Preparing')}</Title>
        </Stack>
      </Center>
    )
  }

  return (
    <Stack h='100%' gap={0}>
      {watching && (
        <Alert color='violet' title={isAutomated(device) ? t('Automated') : t('Automation finished')}>
          {isAutomated(device) ? t('View only. Controls are disabled while the test is running.') : (
            <Group justify='space-between'>
              <Text size='sm'>{t('The test has finished. Take control to interact with the device.')}</Text>
              <Button disabled={!device.usable || Boolean(device.owner)} onClick={() => {
                setWatching(false)
                previousState.current = null
                setJoined(null)
              }}>{t('Use')}</Button>
            </Group>
          )}
        </Alert>
      )}
      <Box style={{flex: '1 1 0%', minHeight: 0}}>
        {basicMode || standalone ?
          <Box className='fill-height'>
            <DeviceControlPanel device={device} control={control} standalone />
          </Box> :
          <ControlWorkspace device={device} control={control} />}
      </Box>
      {lost && (
        <DeviceLostModal
          device={device}
          onReconnect={() => {
            setLost(false)
            previousState.current = null
            setJoined(null)
          }}
          onLeave={() => {
            setLost(false)
            navigate('/devices')
          }}
          onDismiss={() => setLost(false)}
        />
      )}
    </Stack>
  )
}
