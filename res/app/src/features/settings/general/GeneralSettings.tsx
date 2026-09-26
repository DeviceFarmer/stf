import {Button, Select, Stack} from '@mantine/core'
import {notifications} from '@mantine/notifications'
import {IconCalendarTime, IconDeviceFloppy, IconLanguage, IconMail, IconRestore} from '@tabler/icons-react'
import {isAdmin} from '@/core/app-state'
import {defaultDateFormat} from '@/core/date-format'
import {detectLanguage, languageSettingKey, languages, useTranslation} from '@/core/i18n'
import {resetSettings, useSetting} from '@/core/settings'
import {WidgetCard} from '@/ui/WidgetCard'
import {SettingRow} from '../SettingRow'
import {AlertMessageSettings} from './AlertMessageSettings'
import {DebouncedTextInput} from './DebouncedTextInput'
import classes from './GeneralSettings.module.css'

const languageOptions = Object.entries(languages).map(([value, label]) => ({value, label}))
const defaultEmailAddressSeparator = ','

function LanguageSetting() {
  const {language, t} = useTranslation()
  const [, setLanguage] = useSetting<string>(languageSettingKey, detectLanguage())

  return (
    <SettingRow icon={<IconLanguage size={20} />} label={t('Language')} className='stf-language'>
      <Select
        className='stf-language-select'
        aria-label={t('Language')}
        data={languageOptions}
        value={language}
        onChange={(value) => value && setLanguage(value)}
        allowDeselect={false}
        checkIconPosition='right'
        w={220}
      />
    </SettingRow>
  )
}

function DateFormatSetting() {
  const {t} = useTranslation()
  const [dateFormat, setDateFormat] = useSetting<string>('dateFormat', defaultDateFormat)

  return (
    <SettingRow
      icon={<IconCalendarTime size={20} />}
      label={t('Date format')}
      description={t('Define your own Date format')}
      className='stf-date-format'
    >
      <DebouncedTextInput
        aria-label={t('Date format')}
        placeholder={defaultDateFormat}
        value={dateFormat}
        onCommit={setDateFormat}
        className={classes.mono}
        w={220}
      />
    </SettingRow>
  )
}

function EmailAddressSeparatorSetting() {
  const {t} = useTranslation()
  const [separator, setSeparator] = useSetting<string>('emailAddressSeparator', defaultEmailAddressSeparator)

  return (
    <SettingRow
      icon={<IconMail size={20} />}
      label={t('Email address separator')}
      description={t('Define your own Email address separator')}
      className='stf-email-address-separator'
    >
      <DebouncedTextInput
        aria-label={t('Email address separator')}
        placeholder={defaultEmailAddressSeparator}
        value={separator}
        onCommit={setSeparator}
        className={classes.mono}
        w={80}
      />
    </SettingRow>
  )
}

function LocalSettings() {
  const {t} = useTranslation()

  return (
    <WidgetCard
      className='stf-local-settings'
      icon={IconDeviceFloppy}
      title={t('Local Settings')}
      flush
    >
      <SettingRow icon={<IconRestore size={20} />} label={t('Reset Settings')}>
        <Button
          color='red'
          variant='light'
          leftSection={<IconRestore size={16} />}
          className='stf-reset-settings'
          onClick={() => {
            resetSettings()
            notifications.show({color: 'green', message: t('Settings cleared')})
          }}
        >
          {t('Reset')}
        </Button>
      </SettingRow>
    </WidgetCard>
  )
}

export default function GeneralSettings() {
  return (
    <Stack gap='lg' className='stf-general'>
      <WidgetCard flush>
        <LanguageSetting />
        <DateFormatSetting />
        <EmailAddressSeparatorSetting />
      </WidgetCard>
      {isAdmin() && <AlertMessageSettings />}
      <LocalSettings />
    </Stack>
  )
}
