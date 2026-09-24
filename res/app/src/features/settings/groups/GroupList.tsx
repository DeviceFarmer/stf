import {useState} from 'react'
import {
  ActionIcon
  , Badge
  , Button
  , Card
  , Center
  , Checkbox
  , Group
  , Loader
  , Text
  , ThemeIcon
  , Title
  , Tooltip
  , UnstyledButton
} from '@mantine/core'
import {
  IconDeviceMobile
  , IconLock
  , IconLockOpen
  , IconMail
  , IconPlus
  , IconTrash
  , IconUser
  , IconUsersGroup
} from '@tabler/icons-react'
import {getClassName, getDuration} from '@/core/common'
import type {Group as StfGroup} from '@/core/groups-api'
import {useTranslation} from '@/core/i18n'
import {mailTo} from '@/ui/mail'
import {NothingToShow} from '@/ui/NothingToShow'
import {PageControls, PerPageSelect, SearchInput, useItemsPerPage, usePaged} from '@/ui/Pager'
import {toggled} from '@/ui/selection'
import {createGroup, removeGroups} from './actions'
import {classColor, groupStatus, isAdminUser} from './rules'
import {useGroupsStore} from './store'
import classes from './GroupsSettings.module.css'

function QuotaSummary() {
  const {t} = useTranslation()
  const quotas = useGroupsStore((state) => state.currentUser.groups?.quotas)
  if (!quotas?.allocated) {
    return null
  }
  return (
    <Group gap='md' className={classes.quotas}>
      <Text size='xs' c='dimmed'>
        {t('Groups')}: <b>{quotas.consumed?.number ?? 0}</b> / {quotas.allocated.number}
      </Text>
      <Text size='xs' c='dimmed'>
        {t('Duration')}: <b>{getDuration(quotas.consumed?.duration ?? 0)}</b> / {getDuration(quotas.allocated.duration)}
      </Text>
    </Group>
  )
}

export function GroupList({
  groups
  , filtered
  , search
  , onSearchChange
  , selectedId
  , onSelect
  , confirmRemove
  , onConfirmRemoveChange
}: {
  groups: StfGroup[]
  filtered: StfGroup[]
  search: string
  onSearchChange: (search: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  confirmRemove: boolean
  onConfirmRemoveChange: (value: boolean) => void
}) {
  const {t} = useTranslation()
  const currentUser = useGroupsStore((state) => state.currentUser)
  const loading = useGroupsStore((state) => state.loadingGroups)
  const admin = isAdminUser(currentUser)
  const [perPage, setPerPage] = useItemsPerPage('groupItemsPerPage')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [creating, setCreating] = useState(false)

  const {items: pageItems, page, pageCount, setPage} = usePaged(filtered, perPage)
  const selectedGroups = filtered.filter((group) => checked.has(group.id))
  const removableGroups = selectedGroups.filter((group) => group.privilege !== 'root')
  const allChecked = filtered.length > 0 && selectedGroups.length === filtered.length
  const quotas = currentUser.groups?.quotas
  const consumed = quotas?.consumed?.number
  const allocated = quotas?.allocated?.number
  const canCreate = typeof consumed === 'number' && typeof allocated === 'number' && consumed < allocated

  async function create() {
    setCreating(true)
    let group
    try {
      group = await createGroup()
    }
    finally {
      setCreating(false)
    }
    if (group) {
      onSearchChange('')
      onSelect(group.id)
    }
  }

  async function removeSelection() {
    if (await removeGroups(removableGroups, confirmRemove)) {
      setChecked(new Set())
    }
  }

  return (
    <Card padding={0} className={classes.listCard}>
      <Group justify='space-between' wrap='nowrap' className={classes.listHeader}>
        <Group gap='xs' wrap='nowrap'>
          <ThemeIcon variant='light' radius='md'>
            <IconUsersGroup size={18} />
          </ThemeIcon>
          <Title order={5}>{t('Group list')}</Title>
          <Badge variant='light' color='gray' size='sm'>{groups.length}</Badge>
        </Group>
        <Tooltip label={t('Groups number quota is reached')} disabled={canCreate}>
          <span>
            <Button
              size='xs'
              variant='filled'
              leftSection={<IconPlus size={14} />}
              disabled={!canCreate || creating}
              loading={creating}
              onClick={create}
            >
              {t('Create')}
            </Button>
          </span>
        </Tooltip>
      </Group>
      <QuotaSummary />
      <div className={`groups-header ${classes.toolbar}`}>
        <SearchInput
          value={search}
          onChange={(value) => {
            onSearchChange(value)
            setPage(1)
          }}
          label={t('Group selection')}
        />
        <Group justify='space-between' gap='xs' wrap='nowrap'>
          <Checkbox
            size='xs'
            label={selectedGroups.length ?
              t('{{count}} selected', {count: selectedGroups.length}) :
              t('Select all')}
            checked={allChecked}
            indeterminate={selectedGroups.length > 0 && !allChecked}
            disabled={!filtered.length}
            onChange={() => setChecked(allChecked ? new Set() : new Set(filtered.map((group) => group.id)))}
          />
          <Group gap={4} wrap='nowrap'>
            {admin && (
              <Tooltip label={t('Write an email to the group owner selection')}>
                <ActionIcon
                  variant='default'
                  aria-label={t('Contact Owners')}
                  disabled={!selectedGroups.length}
                  onClick={() => mailTo(selectedGroups.map((group) => group.owner.email))}
                >
                  <IconMail size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={t('Enable/Disable confirmation for group removing')}>
              <ActionIcon
                variant='light'
                color={confirmRemove ? 'green' : 'yellow'}
                aria-label={t('Confirm Remove')}
                aria-pressed={confirmRemove}
                onClick={() => onConfirmRemoveChange(!confirmRemove)}
              >
                {confirmRemove ? <IconLock size={16} /> : <IconLockOpen size={16} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('Remove the group selection')}>
              <Button
                size='compact-sm'
                color='red'
                leftSection={<IconTrash size={14} />}
                disabled={!removableGroups.length}
                onClick={removeSelection}
              >
                {t('Remove')}
              </Button>
            </Tooltip>
          </Group>
        </Group>
      </div>
      {loading && !groups.length && <Center p='xl'><Loader size='sm' /></Center>}
      {!loading && !filtered.length && (
        <NothingToShow message={t('No Groups')} icon={<IconUsersGroup size={30} />} />
      )}
      {filtered.length > 0 && (
        <ul className={`groups-list ${classes.list}`}>
          {pageItems.map((group) => {
            const status = groupStatus(group)
            return (
              <li
                key={group.id}
                data-group-id={group.id}
                className={`list-group-item ${classes.item} ${group.id === selectedId ? classes.itemActive : ''}`}
              >
                <Checkbox
                  size='xs'
                  className={classes.itemCheck}
                  aria-label={group.name}
                  checked={checked.has(group.id)}
                  onChange={() => setChecked((current) => toggled(current, group.id))}
                />
                <UnstyledButton
                  className={classes.itemBody}
                  onClick={() => onSelect(group.id)}
                  aria-current={group.id === selectedId}
                >
                  <Group justify='space-between' gap='xs' wrap='nowrap'>
                    <div className={`group-list-name ${classes.itemName}`}>{group.name}</div>
                    <Badge size='sm' variant='light' color={classColor(group.class)}>
                      {getClassName(group.class)}
                    </Badge>
                  </Group>
                  <div className={classes.itemMeta}>
                    <Badge size='xs' variant='dot' color={status.color}>{t(status.label)}</Badge>
                    <span><IconDeviceMobile size={12} />{group.devices.length}</span>
                    <span><IconUser size={12} />{group.users.length}</span>
                    {admin && <span>{group.owner.name}</span>}
                  </div>
                </UnstyledButton>
              </li>
            )
          })}
        </ul>
      )}
      <Group justify='space-between' gap='xs' className={classes.listFooter}>
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
