import {useMemo, useState} from 'react'
import {ActionIcon, Badge, Button, Tabs, Tooltip} from '@mantine/core'
import {IconMail, IconPlus, IconTrash, IconUser} from '@tabler/icons-react'
import {getItem, listOf} from '@/core/collection'
import type {Group as StfGroup} from '@/core/groups-api'
import {gettext, useTranslation} from '@/core/i18n'
import {mailTo} from '@/ui/mail'
import {tableDataDefaults} from '@/ui/table-model'
import {addGroupUser, addGroupUsers, removeGroupUser, removeGroupUsers} from './actions'
import {canRemoveGroupUser} from './rules'
import {ObjectsTable, type ObjectsColumn} from './shared/ObjectsTable'
import {useGroupsStore} from './store'
import type {SettingsUser} from './types'
import classes from './GroupsSettings.module.css'

export const userColumns: ObjectsColumn<SettingsUser>[] = [
  {name: gettext('Name'), render: (user) => user.name, sortValue: (user) => user.name}
  , {
    name: gettext('Email')
    , render: (user) => <a className={classes.link} href={`mailto:${user.email}`}>{user.email}</a>
    , sortValue: (user) => user.email
  }
  , {
    name: gettext('Privilege')
    , render: (user) => (
      <Badge size='sm' variant='light' color={user.privilege === 'admin' ? 'grape' : 'gray'}>{user.privilege}</Badge>
    )
    , sortValue: (user) => user.privilege
  }
]

const defaultUserData = tableDataDefaults(userColumns.map((column) => ({name: column.name})))

function ContactButton({users, label}: {users: SettingsUser[], label: string}) {
  const {t} = useTranslation()
  return (
    <Tooltip label={label}>
      <Button
        size='xs'
        variant='default'
        leftSection={<IconMail size={14} />}
        disabled={!users.length}
        onClick={() => mailTo(users.map((user) => user.email))}
      >
        {t('Contact Users')}
      </Button>
    </Tooltip>
  )
}

export function GroupUsers({group}: {group: StfGroup}) {
  const {t} = useTranslation()
  const users = useGroupsStore((state) => state.users)
  const [view, setView] = useState<string>('group')

  const groupUsers = useMemo(
    () => group.users.map((email) => getItem(users, email)).filter((user) => Boolean(user)) as SettingsUser[]
    , [group.users, users]
  )
  const availableUsers = useMemo(() => {
    const members = new Set(group.users)
    return listOf(users).filter((user) => !members.has(user.email))
  }, [group.users, users])

  return (
    <Tabs value={view} onChange={(value) => value && setView(value)} variant='pills' keepMounted={false}>
      <Tabs.List mb='md'>
        <Tabs.Tab
          value='group'
          leftSection={<IconUser size={14} />}
          rightSection={<Badge size='xs' variant='white' color='gray'>{groupUsers.length}</Badge>}
        >
          {t('Group users')}
        </Tabs.Tab>
        <Tabs.Tab
          value='available'
          leftSection={<IconPlus size={14} />}
          rightSection={<Badge size='xs' variant='white' color='gray'>{availableUsers.length}</Badge>}
        >
          {t('Available users')}
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value='group' className='group-users'>
        <ObjectsTable
          rows={groupUsers}
          rowKey={(user) => user.email}
          columns={userColumns}
          settingKey='groupUserData'
          defaultData={defaultUserData}
          searchLabel={t('Group user selection')}
          emptyMessage={t('No group users')}
          emptyIcon={<IconUser size={30} />}
          canSelect={(user) => canRemoveGroupUser(group, user)}
          rowAction={(user) => (
            <ActionIcon
              variant='subtle'
              color='red'
              aria-label={t('Remove')}
              className='group-remove-user'
              disabled={!canRemoveGroupUser(group, user)}
              onClick={() => removeGroupUser(group, user)}
            >
              <IconTrash size={16} />
            </ActionIcon>
          )}
          actions={(selected, clear) => (
            <>
              <ContactButton users={selected} label={t('Write a mail to the group user selection')} />
              <Button
                size='xs'
                color='red'
                leftSection={<IconTrash size={14} />}
                disabled={!selected.length}
                onClick={async() => {
                  if (await removeGroupUsers(group, selected)) {
                    clear()
                  }
                }}
              >
                {t('Remove')}
              </Button>
            </>
          )}
        />
      </Tabs.Panel>
      <Tabs.Panel value='available' className='available-users'>
        <ObjectsTable
          rows={availableUsers}
          rowKey={(user) => user.email}
          columns={userColumns}
          settingKey='userData'
          defaultData={defaultUserData}
          searchLabel={t('Available user selection')}
          emptyMessage={t('No available users')}
          emptyIcon={<IconUser size={30} />}
          rowAction={(user) => (
            <ActionIcon
              variant='light'
              aria-label={t('Add')}
              className='group-add-user'
              onClick={() => addGroupUser(group, user)}
            >
              <IconPlus size={16} />
            </ActionIcon>
          )}
          actions={(selected, clear) => (
            <>
              <ContactButton users={selected} label={t('Write a mail to the available user selection')} />
              <Button
                size='xs'
                variant='filled'
                leftSection={<IconPlus size={14} />}
                disabled={!selected.length}
                onClick={async() => {
                  if (await addGroupUsers(group, selected)) {
                    clear()
                  }
                }}
              >
                {t('Add')}
              </Button>
            </>
          )}
        />
      </Tabs.Panel>
    </Tabs>
  )
}
