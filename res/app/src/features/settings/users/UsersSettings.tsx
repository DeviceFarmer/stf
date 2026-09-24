import {Fragment, useMemo, useState} from 'react'
import {
  ActionIcon
  , Badge
  , Button
  , Card
  , Center
  , Checkbox
  , Collapse
  , Group
  , Loader
  , Popover
  , Select
  , Stack
  , Table
  , Text
  , ThemeIcon
  , Title
  , Tooltip
} from '@mantine/core'
import {notifications} from '@mantine/notifications'
import {
  IconAdjustments
  , IconFilter
  , IconLock
  , IconLockOpen
  , IconMail
  , IconTrash
  , IconUser
  , IconUserPlus
  , IconUsersGroup
} from '@tabler/icons-react'
import sortBy from 'lodash/sortBy'
import {appState} from '@/core/app-state'
import {getItem, listOf} from '@/core/collection'
import {getDuration} from '@/core/common'
import {useTranslation} from '@/core/i18n'
import {useSetting} from '@/core/settings'
import {userSettingsEvents, usersApi, userViewEvents, type UserRemovalFilters} from '@/core/users-api'
import {mailTo} from '@/ui/mail'
import {errorMessage, openConfirm, withErrorModal} from '@/ui/modals'
import {NothingToShow} from '@/ui/NothingToShow'
import {PageControls, PerPageSelect, SearchInput, useItemsPerPage, usePaged} from '@/ui/Pager'
import {searchFilter} from '@/ui/paging'
import {toggled} from '@/ui/selection'
import type {SettingsUser} from '../groups/types'
import {useLiveCollection, type LiveCollectionSource} from '../use-live-collection'
import {CreateUserForm} from './CreateUserForm'
import {QuotasForm, type QuotaValues} from './QuotasForm'
import classes from './UsersSettings.module.css'

const usersFields = 'email,name,privilege,groups.quotas'
const removingFilterOptions = ['True', 'False', 'Any']
const defaultRemovingFilters: UserRemovalFilters = {groupOwner: 'False'}

const [createdEvent, deletedEvent, updatedEvent] = userSettingsEvents
const [viewUpdatedEvent] = userViewEvents

const usersSource: LiveCollectionSource<SettingsUser> = {
  load: () => usersApi.getUsers(usersFields)
    .then((response) => response.users as SettingsUser[])
    .catch((error) => {
      notifications.show({color: 'red', message: errorMessage(error)})
      return []
    })
  , keyOf: (user) => user.email
  , itemOf: (message: {user: SettingsUser}) => message.user
  , events: {created: createdEvent, deleted: deletedEvent, updated: [updatedEvent, viewUpdatedEvent]}
}

function userQuotas(user: SettingsUser): QuotaValues {
  const quotas = user.groups?.quotas
  return {
    number: quotas?.allocated?.number ?? 0
    , duration: quotas?.allocated?.duration ?? 0
    , repetitions: quotas?.repetitions ?? 0
  }
}

function defaultQuotas(user: SettingsUser): QuotaValues {
  const quotas = user.groups?.quotas
  return {
    number: quotas?.defaultGroupsNumber ?? 0
    , duration: quotas?.defaultGroupsDuration ?? 0
    , repetitions: quotas?.defaultGroupsRepetitions ?? 0
  }
}

function quotasKey(values: QuotaValues): string {
  return `${values.number}|${values.duration}|${values.repetitions}`
}

function RemovingFilters({filters, onChange}: {
  filters: UserRemovalFilters
  onChange: (filters: UserRemovalFilters) => void
}) {
  const {t} = useTranslation()
  return (
    <Popover position='bottom-end' shadow='md' withinPortal>
      <Popover.Target>
        <Tooltip label={t('Set filters for user removing')}>
          <Button
            size='xs'
            variant='light'
            color='red'
            leftSection={<IconFilter size={14} />}
            rightSection={<Badge size='xs' variant='white' color='red'>{filters.groupOwner}</Badge>}
          >
            {t('Filters')}
          </Button>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className='user-removing-filters'>
        <Stack gap='xs' w={220}>
          <Text size='sm' fw={600}>{t('Removing filters')}</Text>
          <Select
            size='xs'
            label={(
              <Tooltip label={t('Filter on user group ownership')}>
                <span>{t('Group Owner')}</span>
              </Tooltip>
            )}
            allowDeselect={false}
            comboboxProps={{withinPortal: false}}
            data={removingFilterOptions}
            value={filters.groupOwner}
            onChange={(groupOwner) => groupOwner && onChange({...filters, groupOwner})}
          />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

export default function UsersSettings() {
  const {t} = useTranslation()
  const {collection: users, loading} = useLiveCollection(usersSource)
  const list = useMemo(() => sortBy(listOf(users), (user) => user.name.toLowerCase()), [users])
  const adminUser = getItem(users, appState.user.email)
  const [storedFilters, setFilters] = useSetting<UserRemovalFilters>('UsersRemovingFilters', defaultRemovingFilters)
  const filters = removingFilterOptions.includes(storedFilters?.groupOwner) ? storedFilters : defaultRemovingFilters
  const [perPage, setPerPage] = useItemsPerPage('userItemsPerPage')
  const [search, setSearch] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [confirmRemove, setConfirmRemove] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showDefaults, setShowDefaults] = useState(false)

  const filtered = searchFilter(list, search)
  const {items: pageItems, page, pageCount, setPage} = usePaged(filtered, perPage)
  const selectedUsers = filtered.filter((user) => checked.has(user.email))
  const removableUsers = selectedUsers.filter((user) => user.privilege !== 'admin')
  const allChecked = filtered.length > 0 && selectedUsers.length === filtered.length

  async function removeUser(user: SettingsUser) {
    if (confirmRemove &&
        !await openConfirm({title: t('Warning'), message: t('Really delete this user?'), danger: true})) {
      return
    }
    await withErrorModal(() => usersApi.removeUser(user.email, filters))
  }

  async function removeSelection() {
    if (confirmRemove &&
        !await openConfirm({title: t('Warning'), message: t('Really delete this selection of users?'), danger: true})) {
      return
    }
    const {error} = await withErrorModal(() => usersApi.removeUsers(filters, removableUsers.map((user) => user.email)))
    if (!error) {
      setChecked(new Set())
    }
  }

  return (
    <Card padding={0} className='stf-users'>
      <Group justify='space-between' className={classes.header}>
        <Group gap='xs'>
          <ThemeIcon variant='light' radius='md'>
            <IconUser size={18} />
          </ThemeIcon>
          <Title order={5}>{t('User list')}</Title>
          <Badge variant='light' color='gray' size='sm'>{list.length}</Badge>
        </Group>
        <Button
          size='xs'
          variant={showCreate ? 'filled' : 'light'}
          leftSection={<IconUserPlus size={14} />}
          onClick={() => setShowCreate(!showCreate)}
          aria-expanded={showCreate}
        >
          {t('Create new user')}
        </Button>
      </Group>
      <Collapse expanded={showCreate}>
        <CreateUserForm className={classes.section} onCreated={() => setShowCreate(false)} />
      </Collapse>
      <Collapse expanded={showDefaults}>
        {adminUser && (
          <div className={`user-default-quotas ${classes.section}`}>
            <Group gap='xs' mb='sm'>
              <IconUsersGroup size={16} />
              <Title order={6}>{t('Default groups quotas')}</Title>
            </Group>
            <QuotasForm
              key={quotasKey(defaultQuotas(adminUser))}
              initial={defaultQuotas(adminUser)}
              onSave={(values) => withErrorModal(() => usersApi.updateDefaultUserGroupsQuotas(
                values.number
                , values.duration
                , values.repetitions
              ))}
            />
          </div>
        )}
      </Collapse>
      <Group justify='space-between' gap='xs' className={`user-header ${classes.toolbar}`}>
        <Group gap='sm'>
          <SearchInput
            className={classes.search}
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            label={t('User selection')}
          />
          <Checkbox
            size='xs'
            label={selectedUsers.length ?
              t('{{count}} selected', {count: selectedUsers.length}) :
              t('Select all')}
            checked={allChecked}
            indeterminate={selectedUsers.length > 0 && !allChecked}
            disabled={!filtered.length}
            onChange={() => setChecked(allChecked ? new Set() : new Set(filtered.map((user) => user.email)))}
          />
        </Group>
        <Group gap='xs'>
          <Tooltip label={t('Write an email to the user selection')}>
            <Button
              size='xs'
              variant='default'
              leftSection={<IconMail size={14} />}
              disabled={!selectedUsers.length}
              onClick={() => mailTo(selectedUsers.map((user) => user.email))}
            >
              {t('Contact Users')}
            </Button>
          </Tooltip>
          <Tooltip label={t('Set groups quotas for new users')}>
            <Button
              size='xs'
              variant={showDefaults ? 'filled' : 'light'}
              leftSection={<IconUsersGroup size={14} />}
              aria-expanded={showDefaults}
              onClick={() => setShowDefaults(!showDefaults)}
            >
              {t('Default Groups Quotas')}
            </Button>
          </Tooltip>
          <RemovingFilters filters={filters} onChange={setFilters} />
          <Tooltip label={t('Enable/Disable confirmation for user removing')}>
            <ActionIcon
              variant='light'
              size='md'
              color={confirmRemove ? 'green' : 'yellow'}
              aria-label={t('Confirm Remove')}
              aria-pressed={confirmRemove}
              onClick={() => setConfirmRemove(!confirmRemove)}
            >
              {confirmRemove ? <IconLock size={16} /> : <IconLockOpen size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('Remove the user selection')}>
            <Button
              size='xs'
              color='red'
              leftSection={<IconTrash size={14} />}
              disabled={!removableUsers.length}
              onClick={removeSelection}
            >
              {t('Remove')}
            </Button>
          </Tooltip>
        </Group>
      </Group>
      {loading && <Center p='xl'><Loader size='sm' /></Center>}
      {!loading && !filtered.length && <NothingToShow message={t('No Users')} icon={<IconUser size={30} />} />}
      {filtered.length > 0 && (
        <Table.ScrollContainer minWidth={760} type='native'>
          <Table highlightOnHover verticalSpacing={6} className={`user-list ${classes.table}`}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className={classes.checkCell} />
                <Table.Th className={classes.th}>{t('Name')}</Table.Th>
                <Table.Th className={classes.th}>{t('Email')}</Table.Th>
                <Table.Th className={classes.th}>{t('Privilege')}</Table.Th>
                <Table.Th className={classes.th}>{t('Groups')}</Table.Th>
                <Table.Th className={classes.th}>{t('Duration')}</Table.Th>
                <Table.Th className={classes.th}>{t('Repetitions')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pageItems.map((user) => {
                const quotas = user.groups?.quotas
                const open = expanded.has(user.email)
                return (
                  <Fragment key={user.email}>
                    <Table.Tr className='selectable' data-email={user.email}>
                      <Table.Td className={classes.checkCell}>
                        <Checkbox
                          size='xs'
                          aria-label={user.email}
                          checked={checked.has(user.email)}
                          onChange={() => setChecked((current) => toggled(current, user.email))}
                        />
                      </Table.Td>
                      <Table.Td>
                        <a className={`user-list-name ${classes.name}`} href={`mailto:${user.email}`}>{user.name}</a>
                      </Table.Td>
                      <Table.Td>{user.email}</Table.Td>
                      <Table.Td>
                        <Badge size='sm' variant='light' color={user.privilege === 'admin' ? 'grape' : 'gray'}>
                          {user.privilege}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{quotas?.consumed?.number ?? 0} / {quotas?.allocated?.number ?? 0}</Table.Td>
                      <Table.Td>
                        {getDuration(quotas?.consumed?.duration ?? 0)} / {getDuration(quotas?.allocated?.duration ?? 0)}
                      </Table.Td>
                      <Table.Td>{quotas?.repetitions ?? 0}</Table.Td>
                      <Table.Td>
                        <Group gap={4} justify='flex-end' wrap='nowrap'>
                          <Button
                            size='compact-xs'
                            variant={open ? 'filled' : 'light'}
                            leftSection={<IconAdjustments size={12} />}
                            aria-expanded={open}
                            onClick={() => setExpanded((current) => toggled(current, user.email))}
                          >
                            {t('Groups Quotas')}
                          </Button>
                          <ActionIcon
                            variant='subtle'
                            color='red'
                            aria-label={t('Remove')}
                            className='user-remove'
                            disabled={user.privilege === 'admin'}
                            onClick={() => removeUser(user)}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                    {open && (
                      <Table.Tr className={classes.quotaRow}>
                        <Table.Td />
                        <Table.Td colSpan={7}>
                          <QuotasForm
                            key={quotasKey(userQuotas(user))}
                            className={`user-quotas ${classes.quotaForm}`}
                            initial={userQuotas(user)}
                            onSave={(values) => withErrorModal(() => usersApi.updateUserGroupsQuotas(
                              user.email
                              , values.number
                              , values.duration
                              , values.repetitions
                            ))}
                          />
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Group justify='space-between' gap='xs' className={classes.footer}>
        <PerPageSelect
          value={perPage}
          onChange={(value) => {
            setPerPage(value)
            setPage(1)
          }}
        />
        <PageControls page={page} pageCount={pageCount} onPageChange={setPage} total={filtered.length} />
      </Group>
    </Card>
  )
}
