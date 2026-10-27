import {lazy, Suspense, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ComponentType} from 'react'
import {useNavigate, useParams, useSearchParams} from 'react-router'
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
import type {Device, DeviceOwner} from '@/core/devices/types'
import {inviteDevice, releaseDevice} from '@/core/group'
import {currentUser} from '@/core/user'
import {gettext, useTranslation} from '@/core/i18n'
import {setSetting, useSetting} from '@/core/settings'
import {basicMode, useStandalone} from '@/ui/modes'
import {usePageTitle} from '@/ui/page-title'
import {stateColor} from '@/ui/device-state'
import {DeviceImage} from '@/ui/DeviceImage'
import {notifyFailure} from '@/ui/notify'
import {confirmReleaseReservation} from '@/ui/release-reservation'
import {reportStandaloneSession} from '../device-list/standalone-session'
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

function manualSession(device?: Device): {channel: string, reservationId: string, owner: DeviceOwner} | null {
  return device?.owner?.reservationId ? {
    channel: device.channel
    , reservationId: device.owner.reservationId
    , owner: device.owner
  } : null
}

function ControlSession() {
  const {serial} = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const watchMode = searchParams.get('mode') === 'watch'
  const sessionActive = useRef(false)
  const {t} = useTranslation()
  const standalone = useStandalone()
  const {device, loading, error} = useDevice(serial)
  const currentDevice = useRef(device)
  useLayoutEffect(() => {
    currentDevice.current = device
  }, [device])
  const [joined, setJoined] = useState<Device | null>(null)
  const [lost, setLost] = useState(false)
  const automated = Boolean(device && isAutomated(device))
  const watching = watchMode || automated
  const [observedAutomation, setObservedAutomation] = useState(false)
  const [takingControl, setTakingControl] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [acceptedManual, setAcceptedManual] = useState<ReturnType<typeof manualSession>>(null)
  const observedManual = useRef<string | null>(null)
  const previousState = useRef<string | null>(null)
  const loadedSerial = device?.serial
  const deviceState = device?.state
  const latestDevice = useEffectEvent(() => device)
  const leaveToDeviceList = useEffectEvent(() => navigate('/', {replace: true}))
  const watch = useEffectEvent(() => {
    if (!watchMode) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('mode', 'watch')
        return next
      }, {replace: true})
    }
  })

  useEffect(() => {
    sessionActive.current = true
    return () => {
      sessionActive.current = false
    }
  }, [])

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
    if (watchMode || isAutomated(target)) {
      watch()
      setJoined(target)
      return
    }
    let active = true
    inviteDevice(target)
      .then((accepted) => {
        if (active) {
          setJoined(target)
          setAcceptedManual(manualSession(accepted))
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
  }, [loadedSerial, joined, watchMode])

  useEffect(() => {
    if (automated) {
      setObservedAutomation(true)
    }
    if (device && (watchMode || automated)) {
      watch()
    }
  }, [device, deviceState, watchMode, automated])

  useEffect(() => {
    // A new explicit watch session must not inherit another run's completion.
    // Reset only once navigation really leaves watch mode: a delayed Use reply
    // must not clear the banner for a newer automation.
    if (!watching) {
      setObservedAutomation(false)
    }
    else {
      setAcceptedManual(null)
    }
  }, [watching])

  useEffect(() => {
    if (!standalone || !device) {
      return
    }
    const accepted = acceptedManual && !watching && acceptedManual.channel === device.channel
    if (accepted && device.using && !isAutomated(device) &&
        acceptedManual.reservationId === device.owner?.reservationId) {
      observedManual.current = acceptedManual.reservationId
      reportStandaloneSession(device, true)
    }
    else if (accepted && !device.owner && observedManual.current !== acceptedManual.reservationId) {
      // The provider ACK can arrive before its first ownership notification.
      // Preserve that exact lease so closing immediately after Use is safe.
      reportStandaloneSession({...device, owner: acceptedManual.owner}, true)
    }
    else {
      reportStandaloneSession(device, false)
    }
  }, [standalone, device, acceptedManual, watching])

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

  const readOnly = watching || !device?.using
  const control: Control | null = useMemo(
    () => (joined ? createControl(joined, joined.channel, () => readOnly) : null)
    , [joined, readOnly]
  )

  function takeControl() {
    if (!device || takingControl || !device.usable || automated || (device.owner && !device.using)) {
      return
    }
    const target = device
    setTakingControl(true)
    // Existing manual access (including the established admin policy) needs
    // only an explicit mode transition, not another ownership request.
    const acquire = target.owner && target.using ? Promise.resolve(target) : inviteDevice(target)
    acquire
      .then((accepted) => {
        if (!sessionActive.current) {
          return
        }
        const current = currentDevice.current
        if (!current || current.serial !== target.serial || current.channel !== target.channel ||
            isAutomated(current) || (current.owner && !current.using)) {
          return
        }
        previousState.current = null
        setAcceptedManual(manualSession(accepted))
        setJoined(target)
        setSetting('lastUsedDevice', target.serial)
        setSearchParams((current) => {
          const next = new URLSearchParams(current)
          next.delete('mode')
          return next
        }, {replace: true})
      })
      .catch((error) => {
        if (sessionActive.current) {
          notifyFailure(error, t('Error'))
        }
      })
      .finally(() => {
        if (sessionActive.current) {
          setTakingControl(false)
        }
      })
  }

  async function releaseReservation() {
    if (!device || !isAutomated(device) || currentUser.privilege !== 'admin' || releasing) {
      return
    }
    const target = {...device, owner: device.owner ? {...device.owner} : null}
    setReleasing(true)
    try {
      const confirmed = await confirmReleaseReservation()
      if (confirmed && sessionActive.current) {
        await releaseDevice(target)
      }
    }
    catch (error) {
      if (sessionActive.current) {
        notifyFailure(error, t('Error'))
      }
    }
    finally {
      if (sessionActive.current) {
        setReleasing(false)
      }
    }
  }

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

  const watchTitle = observedAutomation ? t('Automation finished') : t('View only')
  const watchDescription = observedAutomation ?
    t('The test has finished. Take control to interact with the device.') :
    t('Take control to view and interact with the device.')

  return (
    <Stack h='100%' gap={0}>
      {watching && (
        <Alert color='violet' title={automated ? t('Automated') : watchTitle}>
          {automated ? (
            <Group justify='space-between'>
              <Text size='sm'>{t('View only. Controls are disabled while the test is running.')}</Text>
              {currentUser.privilege === 'admin' && (
                <Button color='red' variant='light' loading={releasing} onClick={releaseReservation}>
                  {t('Release reservation')}
                </Button>
              )}
            </Group>
          ) : (
            <Group justify='space-between'>
              <Text size='sm'>{watchDescription}</Text>
              <Button
                disabled={!device.usable || Boolean(device.owner && !device.using)}
                loading={takingControl}
                onClick={takeControl}
              >
                {t('Use')}
              </Button>
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
