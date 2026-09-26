import type {ComponentType} from 'react'
import {Navigate, useNavigate, useParams} from 'react-router'
import {Group, Tabs, Text, ThemeIcon, Title} from '@mantine/core'
import {useMediaQuery} from '@mantine/hooks'
import {
  IconAdjustmentsHorizontal
  , IconDeviceMobile
  , IconKey
  , IconLayoutGrid
  , IconSettings
  , IconUser
} from '@tabler/icons-react'
import {isAdmin} from '@/core/app-state'
import {gettext, useTranslation} from '@/core/i18n'
import {getSetting, setSetting} from '@/core/settings'
import {Page} from '@/ui/Page'
import {usePageTitle} from '@/ui/page-title'
import DevicesSettings from './devices/DevicesSettings'
import GeneralSettings from './general/GeneralSettings'
import GroupsSettings from './groups/GroupsSettings'
import KeysSettings from './keys/KeysSettings'
import UsersSettings from './users/UsersSettings'
import classes from './SettingsPage.module.css'

interface SettingsTab {
  id: string
  title: string
  icon: ComponentType<{size?: number}>
  component: ComponentType
  adminOnly?: boolean
}

const settingsTabsKey = 'SettingsTabs'

const settingsTabs: SettingsTab[] = [
  {id: 'general', title: gettext('General'), icon: IconAdjustmentsHorizontal, component: GeneralSettings}
  , {id: 'keys', title: gettext('Keys'), icon: IconKey, component: KeysSettings}
  , {id: 'groups', title: gettext('Groups'), icon: IconLayoutGrid, component: GroupsSettings}
  , {id: 'devices', title: gettext('Devices'), icon: IconDeviceMobile, component: DevicesSettings, adminOnly: true}
  , {id: 'users', title: gettext('Users'), icon: IconUser, component: UsersSettings, adminOnly: true}
]

function tabHref(id: string): string {
  return `#/settings/${id}`
}

export default function SettingsPage() {
  const {t} = useTranslation()
  const navigate = useNavigate()
  const params = useParams()
  const wide = useMediaQuery('(min-width: 62em)', true)
  const tabs = settingsTabs.filter((tab) => !tab.adminOnly || isAdmin())
  const requested = (params['*'] || '').split('/')[0]
  const current = tabs.find((tab) => tab.id === requested)

  usePageTitle(t('Settings'))

  if (!current) {
    const remembered = tabs.find((tab) => tab.title === getSetting<string>(settingsTabsKey))
    return <Navigate to={`/settings/${(remembered || tabs[0]!).id}`} replace />
  }

  function select(id: string | null) {
    const tab = tabs.find((candidate) => candidate.id === id)
    if (!tab || tab === current) {
      return
    }
    setSetting(settingsTabsKey, tab.title)
    navigate(`/settings/${tab.id}`)
  }

  return (
    <Page className='stf-settings' innerClassName={classes.inner} maxWidth={1440}>
      <Group gap='md' className={classes.header} wrap='nowrap'>
        <ThemeIcon size={44} radius='md' variant='light'>
          <IconSettings size={26} />
        </ThemeIcon>
        <div>
          <Title order={2}>{t('Settings')}</Title>
          <Text c='dimmed' size='sm'>{t(current.title)}</Text>
        </div>
      </Group>
      <Tabs
        value={current.id}
        onChange={select}
        orientation={wide ? 'vertical' : 'horizontal'}
        variant={wide ? 'pills' : 'default'}
        keepMounted={false}
        className={`heading-for-tabs ${classes.tabs} ${wide ? classes.vertical : classes.horizontal}`}
        classNames={{
          list: `nav-tabs ${classes.list}`
          , tab: classes.tab
          , tabLabel: classes.tabLabel
          , panel: classes.panel
        }}
      >
        <Tabs.List>
          {tabs.map(({id, title, icon: Icon}) => (
            <Tabs.Tab
              key={id}
              value={id}
              component='a'
              renderRoot={(props) => <a {...props} href={tabHref(id)} />}
              onClick={(event) => event.preventDefault()}
              leftSection={<Icon size={18} />}
              className={`stf-settings-tab-${id}`}
            >
              {t(title)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map(({id, component: Panel}) => (
          <Tabs.Panel key={id} value={id}>
            <Panel />
          </Tabs.Panel>
        ))}
      </Tabs>
    </Page>
  )
}
