import type {ComponentType} from 'react'
import {SimpleGrid, Text, ThemeIcon, UnstyledButton} from '@mantine/core'
import {
  IconAdjustmentsHorizontal
  , IconApps
  , IconLayoutGrid
  , IconSettings
  , IconShoppingCart
  , IconWifi
} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import {gettext, useTranslation} from '@/core/i18n'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import classes from '../Dashboard.module.css'

interface AppShortcut {
  title: string
  icon: ComponentType<{size?: number, stroke?: number}>
  color: string
  open: (control: Control) => Promise<unknown>
}

function runActivity(control: Control, command: string) {
  return control.shell(`${command} --activity-clear-top`)
}

function openSetting(control: Control, activity: string) {
  return runActivity(control, `am start -a android.intent.action.MAIN -n com.android.settings/.Settings\\$${activity}`)
}

const shortcuts: AppShortcut[] = [
  {
    title: gettext('Settings')
    , icon: IconSettings
    , color: 'gray'
    , open: (control) => runActivity(control, 'am start -a android.intent.action.MAIN -n com.android.settings/.Settings')
  }
  , {
    title: gettext('App Store')
    , icon: IconShoppingCart
    , color: 'pink'
    , open: (control) => control.openStore()
  }
  , {
    title: gettext('WiFi')
    , icon: IconWifi
    , color: 'cyan'
    , open: (control) => runActivity(control, 'am start -a android.settings.WIFI_SETTINGS')
  }
  , {
    title: gettext('Manage Apps')
    , icon: IconLayoutGrid
    , color: 'orange'
    , open: (control) => runActivity(control, 'am start -a android.settings.APPLICATION_SETTINGS')
  }
  , {
    title: gettext('Developer')
    , icon: IconAdjustmentsHorizontal
    , color: 'green'
    , open: (control) => openSetting(control, 'DevelopmentSettingsActivity')
  }
]

export function AppsCard({control}: {control: Control}) {
  const {t} = useTranslation()

  return (
    <WidgetCard className='stf-apps' icon={IconApps} color='grape' title={t('Apps')}>
      <SimpleGrid type='container' cols={{base: 3, '360px': 5}} spacing='xs' verticalSpacing='xs'>
        {shortcuts.map(({title, icon: Icon, color, open}) => (
          <UnstyledButton
            key={title}
            className={`${classes.appTile} icon-app`}
            onClick={() => open(control).catch(notifyFailure)}
          >
            <ThemeIcon variant='light' color={color} size={40} radius='md'>
              <Icon size={22} stroke={1.7} />
            </ThemeIcon>
            <Text size='xs' fw={500} ta='center' lineClamp={2} className='icon-title'>{t(title)}</Text>
          </UnstyledButton>
        ))}
      </SimpleGrid>
    </WidgetCard>
  )
}
