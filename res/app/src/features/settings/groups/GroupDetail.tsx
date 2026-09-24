import {useEffect, useState} from 'react'
import {ActionIcon, Badge, Button, Card, Group, Stack, Tabs, TextInput, Title, Tooltip} from '@mantine/core'
import {
  IconBan
  , IconCheck
  , IconClock
  , IconDeviceMobile
  , IconLockOpen
  , IconTag
  , IconTrash
  , IconUser
  , IconX
} from '@tabler/icons-react'
import {getClassName} from '@/core/common'
import {formatDate, useDateFormat} from '@/core/date-format'
import type {Group as StfGroup} from '@/core/groups-api'
import {useTranslation} from '@/core/i18n'
import {removeGroup, updateGroupName, updateGroupState} from './actions'
import {GroupConflicts} from './GroupConflicts'
import {GroupDevices} from './GroupDevices'
import {GroupSchedule} from './GroupSchedule'
import {GroupUsers} from './GroupUsers'
import {classColor, groupNameRegex, groupNameRegexStr, groupStatus, isAdminUser} from './rules'
import {useGroupsStore} from './store'
import classes from './GroupsSettings.module.css'

export type GroupTab = 'devices' | 'users' | 'schedule' | 'conflicts'

function NameEditor({group}: {group: StfGroup}) {
  const {t} = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.name)
  const [saving, setSaving] = useState(false)
  const valid = groupNameRegex.test(name)
  const canSave = valid && name !== group.name && !saving

  async function save() {
    if (!canSave) {
      return
    }
    setSaving(true)
    let result
    try {
      result = await updateGroupName(group, name)
    }
    finally {
      setSaving(false)
    }
    if (!result.error) {
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <Group gap={6} wrap='nowrap'>
        <Title order={4} className={classes.detailTitle}>{group.name}</Title>
        <Tooltip label={t('Name')}>
          <ActionIcon
            variant='subtle'
            aria-label={t('Name')}
            className='group-name-edit'
            onClick={() => {
              setName(group.name)
              setEditing(true)
            }}
          >
            <IconTag size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    )
  }

  return (
    <Group gap={6} align='flex-start' wrap='nowrap'>
      <TextInput
        className='group-name-input'
        size='sm'
        w={340}
        maw='100%'
        autoFocus
        placeholder={t('Name')}
        aria-label={t('Name')}
        value={name}
        error={valid ? null : `${t('Regex syntax')}: ${groupNameRegexStr}`}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            save()
          }
          else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
      <ActionIcon
        size='lg'
        variant='filled'
        aria-label={t('Save')}
        disabled={!canSave}
        loading={saving}
        onClick={save}
      >
        <IconCheck size={16} />
      </ActionIcon>
      <ActionIcon size='lg' variant='default' aria-label={t('Cancel')} onClick={() => setEditing(false)}>
        <IconX size={16} />
      </ActionIcon>
    </Group>
  )
}

export function GroupDetail({group, tab, onTabChange, confirmRemove}: {
  group: StfGroup
  tab: GroupTab
  onTabChange: (tab: GroupTab) => void
  confirmRemove: boolean
}) {
  const {t} = useTranslation()
  const admin = useGroupsStore((state) => isAdminUser(state.currentUser))
  const conflicts = useGroupsStore((state) => state.conflicts[group.id])
  const dateFormat = useDateFormat()
  const status = groupStatus(group)
  const dates = group.dates?.[0]
  const current = tab === 'conflicts' && !conflicts ? 'devices' : tab

  useEffect(() => {
    if (conflicts) {
      onTabChange('conflicts')
    }
  }, [conflicts, onTabChange])

  return (
    <Card className='group-detail' data-group-id={group.id}>
      <Group justify='space-between' align='flex-start' gap='sm'>
        <Stack gap={6} miw={0}>
          <NameEditor key={group.id} group={group} />
          <Group gap={6}>
            <Badge variant='light' color={classColor(group.class)}>{getClassName(group.class)}</Badge>
            <Badge variant='dot' color={status.color}>{t(status.label)}</Badge>
          </Group>
          <div className={classes.meta}>
            <span>{t('Identifier')}: <b className={classes.mono}>{group.id}</b></span>
            {admin && <span>{t('Owner')}: <b>{group.owner.name}</b></span>}
            {dates && <span>{t('Starting Date')}: <b>{formatDate(dates.start, dateFormat)}</b></span>}
            {dates && <span>{t('Expiration Date')}: <b>{formatDate(dates.stop, dateFormat)}</b></span>}
          </div>
        </Stack>
        <Group gap='xs'>
          {group.state === 'pending' && (
            <Button
              size='xs'
              color='orange'
              className='group-get-ready'
              leftSection={<IconLockOpen size={14} />}
              onClick={() => updateGroupState(group)}
            >
              {t('Get ready')}
            </Button>
          )}
          <Button
            size='xs'
            color='red'
            className='group-remove'
            leftSection={<IconTrash size={14} />}
            disabled={group.privilege === 'root'}
            onClick={() => removeGroup(group, confirmRemove)}
          >
            {t('Remove')}
          </Button>
        </Group>
      </Group>
      <Tabs
        mt='md'
        value={current}
        onChange={(value) => value && onTabChange(value as GroupTab)}
        keepMounted={false}
      >
        <Tabs.List>
          <Tabs.Tab
            value='devices'
            leftSection={<IconDeviceMobile size={16} />}
            rightSection={<Badge size='xs' variant='light' color='gray'>{group.devices.length}</Badge>}
          >
            {t('Devices')}
          </Tabs.Tab>
          <Tabs.Tab
            value='users'
            leftSection={<IconUser size={16} />}
            rightSection={<Badge size='xs' variant='light' color='gray'>{group.users.length}</Badge>}
          >
            {t('Users')}
          </Tabs.Tab>
          <Tabs.Tab value='schedule' leftSection={<IconClock size={16} />}>
            {t('Schedule')}
          </Tabs.Tab>
          {conflicts && (
            <Tabs.Tab value='conflicts' color='red' leftSection={<IconBan size={16} />}>
              {t('Conflicts')}
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value='devices' className={classes.panel}>
          <GroupDevices key={group.id} group={group} />
        </Tabs.Panel>
        <Tabs.Panel value='users' className={classes.panel}>
          <GroupUsers key={group.id} group={group} />
        </Tabs.Panel>
        <Tabs.Panel value='schedule' className={classes.panel}>
          <GroupSchedule group={group} />
        </Tabs.Panel>
        {conflicts && (
          <Tabs.Panel value='conflicts' className={classes.panel}>
            <GroupConflicts key={group.id} group={group} conflicts={conflicts} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Card>
  )
}
