import {useState} from 'react'
import {Alert, Badge, Button, Group, Input, Select, SimpleGrid, Slider, Stack, Text, TextInput} from '@mantine/core'
import {IconAlertTriangle, IconLock} from '@tabler/icons-react'
import {getItem} from '@/core/collection'
import {classOptions} from '@/core/common'
import {fromDatetimeLocal, toDatetimeLocal} from '@/core/date-format'
import type {Group as StfGroup} from '@/core/groups-api'
import {useTranslation} from '@/core/i18n'
import {updateGroupSchedule} from './actions'
import {
  isAdminUser
  , isNoRepetitionsGroup
  , isOriginGroup
  , scheduleDraftOf
  , validateSchedule
  , type ScheduleDraft
} from './rules'
import {useGroupsStore} from './store'
import classes from './GroupsSettings.module.css'

function withClass(draft: ScheduleDraft, groupClass: string): ScheduleDraft {
  if (isNoRepetitionsGroup(groupClass)) {
    return {...draft, groupClass, repetitions: 0}
  }
  return {...draft, groupClass, repetitions: draft.repetitions === 0 ? 1 : draft.repetitions}
}

function ScheduleForm({group}: {group: StfGroup}) {
  const {t} = useTranslation()
  const currentUser = useGroupsStore((state) => state.currentUser)
  const owner = useGroupsStore((state) => getItem(state.users, group.owner.email))
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftOf(group))
  const [saving, setSaving] = useState(false)
  const pending = group.state === 'pending'
  const admin = isAdminUser(currentUser)
  const reason = validateSchedule(group, draft, {admin, owner})
  const canSave = pending && reason === '' && !saving
  const maxRepetitions = owner?.groups?.quotas?.repetitions
  const options = classOptions.filter((option) => option.privilege === 'user' ||
    option.privilege === currentUser.privilege && currentUser.email === group.owner.email)

  async function save() {
    setSaving(true)
    try {
      await updateGroupSchedule(group, draft)
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap='md' className='group-schedule'>
      {!pending && (
        <Alert variant='light' color='gray' icon={<IconLock size={18} />}>
          {t('The schedule can only be changed while the group is pending')}
        </Alert>
      )}
      <fieldset disabled={!pending} className={classes.fieldset}>
        <SimpleGrid cols={{base: 1, sm: 2}} spacing='md'>
          <Select
            label={t('Class')}
            name='class'
            allowDeselect={false}
            disabled={!pending}
            data={options.map((option) => ({value: option.id, label: t(option.name)}))}
            value={draft.groupClass}
            onChange={(value) => value && setDraft(withClass(draft, value))}
          />
          {!isNoRepetitionsGroup(draft.groupClass) && (
            <Input.Wrapper label={t('Repetitions')}>
              <Group gap='sm' wrap='nowrap' mih={36}>
                <Slider
                  flex={1}
                  min={0}
                  max={typeof maxRepetitions === 'number' ? maxRepetitions : 100}
                  step={1}
                  disabled={!pending}
                  value={draft.repetitions}
                  onChange={(repetitions) => setDraft({...draft, repetitions})}
                  aria-label={t('Repetitions')}
                />
                <Badge variant='light' size='lg' radius='sm' miw={40}>{draft.repetitions}</Badge>
              </Group>
            </Input.Wrapper>
          )}
          <TextInput
            type='datetime-local'
            name='startDate'
            step={1}
            required
            label={t('Starting Date')}
            disabled={!pending}
            value={toDatetimeLocal(draft.start)}
            onChange={(event) => setDraft({...draft, start: fromDatetimeLocal(event.currentTarget.value)})}
          />
          <TextInput
            type='datetime-local'
            name='stopDate'
            step={1}
            required
            label={t('Expiration Date')}
            disabled={!pending}
            value={toDatetimeLocal(draft.stop)}
            onChange={(event) => setDraft({...draft, stop: fromDatetimeLocal(event.currentTarget.value)})}
          />
        </SimpleGrid>
      </fieldset>
      <Group gap='md'>
        <Button variant='filled' disabled={!canSave} loading={saving} onClick={save}>
          {t('Save')}
        </Button>
        {pending && reason === '' && isOriginGroup(draft.groupClass) && (
          <Text size='sm' c='orange' className='group-schedule-warning'>
            <IconAlertTriangle size={14} /> {t('Saving will also get ready the group!')}
          </Text>
        )}
        {pending && reason !== '' && reason !== 'No change' && (
          <Text size='sm' c='red' className='group-schedule-error'>{t(reason)}</Text>
        )}
      </Group>
    </Stack>
  )
}

export function GroupSchedule({group}: {group: StfGroup}) {
  const dates = group.dates?.[0]
  const scheduleKey = [group.id, group.class, group.repetitions, dates?.start, dates?.stop].join('|')
  return <ScheduleForm key={scheduleKey} group={group} />
}
