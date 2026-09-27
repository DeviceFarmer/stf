import type {ComponentType} from 'react'
import {ActionIcon, Stack, Text, Tooltip, type MantineColor} from '@mantine/core'
import {
  IconCamera
  , IconPlayerPlay
  , IconPlayerSkipBack
  , IconPlayerSkipForward
  , IconPlayerStop
  , IconPlayerTrackNext
  , IconPlayerTrackPrev
  , IconPower
  , IconSearch
  , IconSettings
  , IconVolume
  , IconVolume2
  , IconVolume3
} from '@tabler/icons-react'
import {gettext, useTranslation} from '@/core/i18n'
import {WidgetCard} from '@/ui/WidgetCard'
import type {PaneProps} from '../../types'

interface SpecialKey {
  key: string
  label: string
  icon?: ComponentType<{size?: number}>
  text?: string
  color?: MantineColor
}

const keyGroups: Array<{title: string, keys: SpecialKey[]}> = [
  {
    title: gettext('Special Keys')
    , keys: [
      {key: 'power', label: gettext('Power'), icon: IconPower, color: 'red'}
      , {key: 'camera', label: gettext('Camera'), icon: IconCamera}
      , {key: 'switch_charset', label: gettext('Switch Charset'), text: 'Aa', color: 'cyan'}
      , {key: 'search', label: gettext('Search'), icon: IconSearch}
    ]
  }
  , {
    title: gettext('Volume')
    , keys: [
      {key: 'mute', label: gettext('Mute'), icon: IconVolume3}
      , {key: 'volume_down', label: gettext('Volume Down'), icon: IconVolume2}
      , {key: 'volume_up', label: gettext('Volume Up'), icon: IconVolume}
    ]
  }
  , {
    title: gettext('Media')
    , keys: [
      {key: 'media_rewind', label: gettext('Rewind'), icon: IconPlayerTrackPrev}
      , {key: 'media_previous', label: gettext('Previous'), icon: IconPlayerSkipBack}
      , {key: 'media_play_pause', label: gettext('Play/Pause'), icon: IconPlayerPlay}
      , {key: 'media_stop', label: gettext('Stop'), icon: IconPlayerStop}
      , {key: 'media_next', label: gettext('Next'), icon: IconPlayerSkipForward}
      , {key: 'media_fast_forward', label: gettext('Fast Forward'), icon: IconPlayerTrackNext}
    ]
  }
]

export function AdvancedInputCard({control}: Pick<PaneProps, 'control'>) {
  const {t} = useTranslation()
  return (
    <WidgetCard title={t('Advanced Input')} icon={IconSettings} color='pink' className='stf-advanced-input'>
      <Stack gap='md'>
        {keyGroups.map((group) => (
          <div key={group.title}>
            <Text size='xs' fw={600} c='dimmed' tt='uppercase' mb={6}>{t(group.title)}</Text>
            <ActionIcon.Group>
              {group.keys.map(({key, label, icon: Icon, text, color}) => (
                <Tooltip key={key} label={t(label)}>
                  <ActionIcon
                    variant='default'
                    size='lg'
                    {...(color ? {c: `${color}.6`} : {})}
                    onClick={() => control.keyPress(key)}
                    aria-label={t(label)}
                    data-key={key}
                  >
                    {Icon ? <Icon size={16} /> : <Text span fw={700} size='sm'>{text}</Text>}
                  </ActionIcon>
                </Tooltip>
              ))}
            </ActionIcon.Group>
          </div>
        ))}
      </Stack>
    </WidgetCard>
  )
}
