import {Alert, SegmentedControl, Switch} from '@mantine/core'
import {IconAlertTriangle, IconMessage, IconSpeakerphone, IconToggleRight} from '@tabler/icons-react'
import isEqual from 'lodash/isEqual'
import {alertLevelColors, type AlertMessage} from '@/core/alert-message'
import {gettext, useTranslation} from '@/core/i18n'
import {getSetting, setSetting, useSetting} from '@/core/settings'
import {useSocketEvent} from '@/core/socket'
import {currentUser} from '@/core/user'
import {WidgetCard} from '@/ui/WidgetCard'
import {SettingRow} from '../SettingRow'
import {DebouncedTextInput} from './DebouncedTextInput'
import classes from './GeneralSettings.module.css'

const alertMessageKey = 'alertMessage'

const defaultAlertMessage: AlertMessage = {
  data: '*** This site is currently under maintenance, please wait ***'
  , activation: 'False'
  , level: 'Critical'
}

const alertLevels = [
  {value: 'Information', label: gettext('Information')}
  , {value: 'Warning', label: gettext('Warning')}
  , {value: 'Critical', label: gettext('Critical')}
]

function storedAlertMessage(): AlertMessage {
  return {...defaultAlertMessage, ...getSetting<Partial<AlertMessage>>(alertMessageKey, {})}
}

function updateAlertMessage(change: Partial<AlertMessage>) {
  setSetting(alertMessageKey, {...storedAlertMessage(), ...change})
}

export function AlertMessageSettings() {
  const {t} = useTranslation()
  const [stored] = useSetting<Partial<AlertMessage>>(alertMessageKey, defaultAlertMessage)
  const alertMessage = {...defaultAlertMessage, ...stored}
  const active = alertMessage.activation === 'True'
  const levelColor: string | undefined = alertLevelColors[alertMessage.level]

  useSocketEvent('user.menu.users.updated', (message: {user?: {email?: string, privilege?: string, settings?: any}}) => {
    const user = message?.user
    const incoming = user?.settings?.alertMessage
    if (user?.privilege === 'admin' && user.email !== currentUser.email && incoming &&
      !isEqual(incoming, getSetting(alertMessageKey))) {
      setSetting(alertMessageKey, incoming)
    }
  })

  return (
    <WidgetCard
      className='stf-alert-message'
      icon={IconSpeakerphone}
      title={t('Alert Message')}
      flush
    >
      <SettingRow
        icon={<IconMessage size={20} />}
        label={t('Text')}
        description={t('Define your own alert message')}
        stacked
      >
        <DebouncedTextInput
          className='stf-alert-message-data'
          aria-label={t('Alert Message')}
          value={alertMessage.data}
          onCommit={(data) => updateAlertMessage({data})}
        />
      </SettingRow>
      <SettingRow
        icon={<IconToggleRight size={20} />}
        label={t('Activation')}
        description={t('Alert message activation')}
      >
        <Switch
          className='stf-alert-message-activation'
          size='md'
          checked={active}
          onChange={(event) => updateAlertMessage({activation: event.currentTarget.checked ? 'True' : 'False'})}
          aria-label={t('Activation')}
        />
      </SettingRow>
      <SettingRow
        icon={<IconAlertTriangle size={20} />}
        label={t('Level')}
        description={t('Alert message level')}
      >
        <SegmentedControl
          className='stf-alert-message-level'
          value={alertMessage.level}
          onChange={(value) => updateAlertMessage({level: value})}
          data={alertLevels.map((option) => ({value: option.value, label: t(option.label)}))}
          {...(levelColor === undefined ? {} : {color: levelColor})}
        />
      </SettingRow>
      <div className={classes.preview}>
        <Alert
          variant='light'
          color={levelColor || 'blue'}
          icon={<IconAlertTriangle size={18} />}
          className={active ? undefined : classes.inactive}
          p='xs'
        >
          {alertMessage.data}
        </Alert>
      </div>
    </WidgetCard>
  )
}
