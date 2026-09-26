import {useEffect, useRef, useState} from 'react'
import {NavLink, Outlet, useLocation, useNavigate} from 'react-router'
import {
  ActionIcon
  , Alert
  , AppShell
  , Badge
  , Box
  , Burger
  , Group
  , SegmentedControl
  , Stack
  , Text
  , Tooltip
  , UnstyledButton
  , useComputedColorScheme
  , useMantineColorScheme
} from '@mantine/core'
import {useDisclosure, useWindowEvent} from '@mantine/hooks'
import {notifications} from '@mantine/notifications'
import {
  IconDeviceMobile
  , IconHelpCircle
  , IconLayoutGrid
  , IconLogout
  , IconMail
  , IconMoon
  , IconSettings
  , IconSitemap
  , IconSun
} from '@tabler/icons-react'
import {alertLevelColors, type AlertMessage} from '@/core/alert-message'
import {appState, isAdmin} from '@/core/app-state'
import {useContactEmail} from '@/core/contact'
import {gettext, languageSettingKey, detectLanguage, setLanguage, useTranslation} from '@/core/i18n'
import {getSocket, onSocket, useSocketEvent} from '@/core/socket'
import {useSetting, useSettingsStore} from '@/core/settings'
import {acceptAdbKey} from '@/core/user'
import {usersApi} from '@/core/users-api'
import {basicMode, useAdminMode, usePlatform, useStandalone} from './modes'
import {openAddAdbKey, openSocketDisconnected, openVersionUpdate} from './modals'
import classes from './AppLayout.module.css'

const headerHeight = 56
const alertStripHeight = 36

const konami = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'
  , 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'Enter'
]

const typingTags = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || typingTags.has(target.tagName))
}

function useLanguageSync() {
  const selected = useSettingsStore((state) => state.settings[languageSettingKey]) as
    string | undefined
  useEffect(() => {
    setLanguage(selected || detectLanguage())
  }, [selected])
}

function useKonamiAdminToggle() {
  const [adminMode, setAdminMode] = useAdminMode()
  const {t} = useTranslation()
  const position = useRef(0)

  useWindowEvent('keydown', (event) => {
    if (isTypingTarget(event.target)) {
      return
    }
    position.current = event.key === konami[position.current] ? position.current + 1 : Number(event.key === konami[0])
    if (position.current === konami.length) {
      position.current = 0
      const next = !adminMode
      setAdminMode(next)
      notifications.show({
        message: next ?
          t('Admin mode has been enabled.') :
          t('Admin mode has been disabled.')
      })
    }
  })
}

function useSocketState() {
  const {t} = useTranslation()

  useEffect(() => {
    let hasFailedOnce = false
    function lost(message: string) {
      hasFailedOnce = true
      openSocketDisconnected(message)
    }
    const unsubscribers = [
      onSocket('connect', () => {
        if (hasFailedOnce) {
          notifications.show({
            color: 'green'
            , title: 'WebSocket'
            , message: t('Connected successfully.')
            , autoClose: 2000
          })
        }
      })
      , onSocket('disconnect', () => lost(gettext('Socket connection was lost')))
      , onSocket('connect_error', () => lost(gettext('Error')))
      , onSocket('error', () => lost(gettext('Error')))
      , onSocket('outdated', () => openVersionUpdate())
    ]
    function unbind() {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
    window.addEventListener('beforeunload', unbind)
    return () => {
      window.removeEventListener('beforeunload', unbind)
      unbind()
    }
  }, [t])
}

function useAlertMessage(): AlertMessage | null {
  const adminAlert = useSettingsStore((state) => state.settings.alertMessage) as
    AlertMessage | undefined
  const [userAlert, setUserAlert] = useState<AlertMessage | null>(null)

  useEffect(() => {
    if (!isAdmin()) {
      usersApi.getUsersAlertMessage()
        .then((response) => setUserAlert(response.alertMessage))
        .catch(() => undefined)
    }
  }, [])

  useSocketEvent('user.menu.users.updated', (message: {user: any}) => {
    if (message.user?.privilege === 'admin') {
      setUserAlert(message.user.settings?.alertMessage || null)
    }
  })

  return isAdmin() ? adminAlert || userAlert : userAlert
}

function logout() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]!.trim()
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
  }
  window.location.href = '/'
  setTimeout(() => getSocket().disconnect(), 100)
}

function NavItem({to, icon, label, accessKey}: {
  to: string
  icon: React.ReactNode
  label: string
  accessKey?: string | undefined
}) {
  return (
    <NavLink
      to={to}
      accessKey={accessKey}
      className={({isActive}) => `${classes.link} ${isActive ? classes.active : ''}`}
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

export function AppLayout() {
  const {t} = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const standalone = useStandalone()
  const [lastUsedDevice] = useSetting<string | undefined>('lastUsedDevice', undefined)
  const [platform, setPlatform] = usePlatform()
  const contactEmail = useContactEmail()
  const [opened, {toggle, close}] = useDisclosure(false)
  const {setColorScheme} = useMantineColorScheme()
  const colorScheme = useComputedColorScheme('light')
  const alertMessage = useAlertMessage()
  const hideMenu = basicMode || standalone
  const isControlRoute = location.pathname.startsWith('/control')

  useLanguageSync()
  useKonamiAdminToggle()
  useSocketState()

  useSocketEvent('user.keys.adb.confirm', (data: {fingerprint: string, title: string}) => {
    openAddAdbKey(data).then((accepted) => {
      if (accepted) {
        acceptAdbKey(data)
      }
    })
  })

  useEffect(() => {
    close()
  }, [location.pathname, close])

  const links = [
    lastUsedDevice ? {
      to: `/control/${lastUsedDevice}`
      , icon: <IconDeviceMobile size={18} />
      , label: t('Control')
    } : null
    , {to: '/devices', icon: <IconSitemap size={18} />, label: t('Devices'), accessKey: '1'}
    , {to: '/groups', icon: <IconLayoutGrid size={18} />, label: t('Groups')}
    , {to: '/settings', icon: <IconSettings size={18} />, label: t('Settings')}
  ].filter(Boolean) as Array<{to: string, icon: React.ReactNode, label: string, accessKey?: string}>

  if (hideMenu) {
    return (
      <Box className='fill-height'>
        <Outlet />
      </Box>
    )
  }

  const alertActive = alertMessage?.activation === 'True'
  const alertColor = alertLevelColors[alertMessage?.level || ''] || 'blue'

  return (
    <AppShell
      header={{height: alertActive ? {base: headerHeight + alertStripHeight, md: headerHeight} : headerHeight}}
      navbar={{width: 260, breakpoint: 'sm', collapsed: {desktop: true, mobile: !opened}}}
      padding={0}
      className='fill-height'
    >
      <AppShell.Header className='stf-menu'>
        <Group h={headerHeight} px='md' justify='space-between' wrap='nowrap'>
          <Group gap='lg' wrap='nowrap'>
            <Burger opened={opened} onClick={toggle} hiddenFrom='sm' size='sm' />
            <UnstyledButton onClick={() => navigate('/devices')} className={classes.logo}>
              <img src='/static/logo/exports/STF-128.png' alt='' width={28} height={28} />
              <Text fw={700} size='lg'>STF</Text>
            </UnstyledButton>
            <Group gap={4} visibleFrom='sm' wrap='nowrap'>
              {links.map((link) => <NavItem key={link.to} {...link} />)}
            </Group>
          </Group>

          {alertActive && (
            <Alert
              visibleFrom='md'
              className={`stf-alert-banner ${classes.banner}`}
              color={alertColor}
              variant='light'
              p={6}
            >
              <Text size='sm' fw={500} ta='center'>{t(alertMessage.data)}</Text>
            </Alert>
          )}

          <Group gap='xs' wrap='nowrap'>
            {isControlRoute && (
              <SegmentedControl
                size='xs'
                className='stf-nav-web-native-button'
                value={platform}
                onChange={setPlatform}
                data={[
                  {value: 'web', label: t('Web')}
                  , {value: 'native', label: t('Native')}
                ]}
                visibleFrom='sm'
              />
            )}
            {contactEmail && (
              <Tooltip label={t('Contact Support')}>
                <ActionIcon
                  variant='subtle'
                  color='gray'
                  size='lg'
                  component='a'
                  href={`mailto:${contactEmail}`}
                  aria-label={t('Contact Support')}
                >
                  <IconMail size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={t('Help')}>
              <ActionIcon
                variant='subtle'
                color='gray'
                size='lg'
                onClick={() => navigate('/help')}
                aria-label={t('Help')}
                accessKey='6'
              >
                <IconHelpCircle size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={colorScheme === 'dark' ? t('Light') : t('Dark')}>
              <ActionIcon
                variant='subtle'
                color='gray'
                size='lg'
                onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
                aria-label='color scheme'
                className='stf-color-scheme'
              >
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('Logout')}>
              <ActionIcon
                variant='subtle'
                color='gray'
                size='lg'
                onClick={logout}
                aria-label={t('Logout')}
                className='stf-logout'
              >
                <IconLogout size={18} />
              </ActionIcon>
            </Tooltip>
            <Badge variant='light' color='gray' tt='none' className='version-text' visibleFrom='xs'>
              v{appState.config.stfVersion}
            </Badge>
          </Group>
        </Group>
        {alertActive && (
          <Alert
            hiddenFrom='md'
            radius={0}
            className={`stf-alert-strip ${classes.strip}`}
            color={alertColor}
            variant='light'
            px='md'
            py={0}
          >
            <Text size='xs' fw={500} ta='center' lineClamp={2}>{t(alertMessage.data)}</Text>
          </Alert>
        )}
      </AppShell.Header>

      <AppShell.Navbar p='md'>
        <Stack gap={4}>
          {links.map((link) => <NavItem key={link.to} {...link} accessKey={undefined} />)}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main className={classes.main}>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}
