import {useMemo, useState, type ReactNode} from 'react'
import {
  Anchor
  , Button
  , Center
  , Group
  , Loader
  , Popover
  , Stack
  , Table
  , Text
  , ThemeIcon
  , Tooltip
} from '@mantine/core'
import {IconDeviceMobile, IconMail, IconUser} from '@tabler/icons-react'
import {useQuery} from '@tanstack/react-query'
import sortBy from 'lodash/sortBy'
import type {Device} from '@/core/devices/types'
import {groupsApi, type Group as StfGroup} from '@/core/groups-api'
import {useTranslation} from '@/core/i18n'
import {mailTo} from '@/ui/mail'
import {Pager, usePaged} from '@/ui/Pager'
import {searchFilter} from '@/ui/paging'
import {sortKey} from '@/ui/table-model'
import {groupDevicesKey, groupUsersKey} from './use-view-groups'
import classes from './GroupListPage.module.css'

const deviceFields = 'serial,version,manufacturer,marketName,sdk,display.width,display.height,model'
const userFields = 'email,name,privilege'
const defaultPerPage = 5

interface GroupMember {
  email: string
  name: string
  privilege: string
}

function usePagedList<T>(items: T[] | undefined, order: (item: T) => unknown) {
  const [search, setSearch] = useState('')
  const [perPage, setPerPage] = useState(defaultPerPage)
  const filtered = useMemo(
    () => searchFilter(sortBy(items || [], (item) => sortKey(order(item))), search)
    , [items, order, search]
  )
  const paged = usePaged(filtered, perPage)
  return {search, setSearch, perPage, setPerPage, filtered, paged}
}

function MembersPopover({count, className, children}: {
  count: number
  className: string
  children: ReactNode
}) {
  const [opened, setOpened] = useState(false)

  return (
    <Popover
      opened={opened && count > 0}
      onChange={setOpened}
      position='bottom-start'
      shadow='md'
      width='min(560px, calc(100vw - 24px))'
      keepMounted={false}
    >
      <Popover.Target>
        <Button
          size='compact-sm'
          variant='light'
          miw={44}
          className={className}
          disabled={count === 0}
          onClick={() => setOpened((value) => !value)}
        >
          {count}
        </Button>
      </Popover.Target>
      <Popover.Dropdown className={classes.membersDropdown}>
        {opened && children}
      </Popover.Dropdown>
    </Popover>
  )
}

function MemberRows({loading, empty, children}: {loading: boolean, empty: boolean, children: ReactNode}) {
  const {t} = useTranslation()
  if (loading) {
    return <Center py='md'><Loader size='sm' /></Center>
  }
  if (empty) {
    return <Text size='sm' c='dimmed' ta='center' py='md'>{t('No results')}</Text>
  }
  return (
    <div className={classes.membersScroll}>
      <Table highlightOnHover verticalSpacing={6} className={classes.membersTable}>
        <Table.Tbody>{children}</Table.Tbody>
      </Table>
    </div>
  )
}

function Detail({label, value}: {label: string, value: ReactNode}) {
  return (
    <span className={classes.detail}>
      <span className={classes.detailLabel}>{label}</span>
      {': '}
      {value}
    </span>
  )
}

const deviceOrder = (device: Device) => device.model
const userOrder = (user: GroupMember) => user.name

function GroupDevicesPanel({group}: {group: StfGroup}) {
  const {t} = useTranslation()
  const devices = useQuery({
    queryKey: groupDevicesKey(group.id)
    , queryFn: async() => (await groupsApi.getGroupDevices(group.id, false, deviceFields)).devices
    , staleTime: 0
  })
  const list = usePagedList(devices.data, deviceOrder)

  return (
    <Stack gap='sm' className='group-devices'>
      <Pager
        searchLabel={t('Device selection')}
        search={list.search}
        onSearchChange={list.setSearch}
        perPage={list.perPage}
        onPerPageChange={list.setPerPage}
        page={list.paged.page}
        pageCount={list.paged.pageCount}
        onPageChange={list.paged.setPage}
        total={list.filtered.length}
        searchWidth={180}
        inPopover
      />
      <MemberRows loading={devices.isPending} empty={!list.filtered.length}>
        {list.paged.items.map((device) => (
          <Table.Tr key={device.serial} className='selectable'>
            <Table.Td w={40}>
              <ThemeIcon variant='light' size='lg' radius='md'>
                <IconDeviceMobile size={20} />
              </ThemeIcon>
            </Table.Td>
            <Table.Td>
              <Text size='sm' fw={500} c='var(--mantine-primary-color-light-color)' className='group-device-name'>
                {`${device.manufacturer} ${device.model} (${device.marketName})`}
              </Text>
              <Text className={`${classes.details} group-device-id`}>
                <Detail label={t('Serial')} value={device.serial} />
                <Detail label={t('OS')} value={device.version} />
                <Detail label={t('Screen')} value={`${device.display?.width}x${device.display?.height}`} />
                <Detail label={t('SDK')} value={device.sdk} />
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </MemberRows>
    </Stack>
  )
}

function GroupUsersPanel({group}: {group: StfGroup}) {
  const {t} = useTranslation()
  const users = useQuery({
    queryKey: groupUsersKey(group.id)
    , queryFn: async() => (await groupsApi.getGroupUsers(group.id, userFields)).users as GroupMember[]
    , staleTime: 0
  })
  const list = usePagedList(users.data, userOrder)

  return (
    <Stack gap='sm' className='group-users'>
      <Group justify='space-between' align='flex-start' gap='xs'>
        <Pager
          searchLabel={t('User selection')}
          search={list.search}
          onSearchChange={list.setSearch}
          perPage={list.perPage}
          onPerPageChange={list.setPerPage}
          page={list.paged.page}
          pageCount={list.paged.pageCount}
          onPageChange={list.paged.setPage}
          total={list.filtered.length}
          searchWidth={180}
          inPopover
        />
        <Tooltip label={t('Write an email to the group user selection')}>
          <Button
            size='xs'
            variant='light'
            leftSection={<IconMail size={14} />}
            disabled={!list.filtered.length}
            onClick={() => mailTo(list.filtered.map((user) => user.email))}
          >
            {t('Contact Users')}
          </Button>
        </Tooltip>
      </Group>
      <MemberRows loading={users.isPending} empty={!list.filtered.length}>
        {list.paged.items.map((user) => (
          <Table.Tr key={user.email} className='selectable'>
            <Table.Td w={40}>
              <ThemeIcon variant='light' size='lg' radius='xl' color='gray'>
                <IconUser size={18} />
              </ThemeIcon>
            </Table.Td>
            <Table.Td>
              <Anchor href={`mailto:${user.email}`} size='sm' fw={500} className='group-user-name'>
                {user.name}
              </Anchor>
              <Text className={`${classes.details} group-user-id`}>
                <Detail label={t('Email')} value={user.email} />
                <Detail label={t('Privilege')} value={user.privilege} />
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </MemberRows>
    </Stack>
  )
}

export function GroupDevicesButton({group}: {group: StfGroup}) {
  return (
    <MembersPopover count={group.devices.length} className='btn-devices'>
      <GroupDevicesPanel group={group} />
    </MembersPopover>
  )
}

export function GroupUsersButton({group}: {group: StfGroup}) {
  return (
    <MembersPopover count={group.users.length} className='btn-users'>
      <GroupUsersPanel group={group} />
    </MembersPopover>
  )
}
