import {useEffect} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import type {User} from '@/core/app-state'
import {deviceSettingsEvents} from '@/core/devices-api'
import {groupsApi, groupViewEvents, type Group} from '@/core/groups-api'
import {onSocket, useSocketEvent} from '@/core/socket'
import {currentUser, getUser} from '@/core/user'
import {userSettingsEvents, userViewEvents} from '@/core/users-api'

const groupsKey = ['group-list', 'groups']
const userKey = ['group-list', 'user']
export const groupDevicesKey = (id: string) => ['group-list', 'devices', id]
export const groupUsersKey = (id: string) => ['group-list', 'users', id]
const memberInvalidationDelay = 400
const [groupCreatedEvent, groupDeletedEvent, groupUpdatedEvent] = groupViewEvents
const [userCreatedEvent, userDeletedEvent] = userSettingsEvents
const [userUpdatedEvent] = userViewEvents

interface GroupMessage {
  group: Group
  users?: string[]
  devices?: string[]
}

function upsert(groups: Group[] | undefined, group: Group): Group[] | undefined {
  if (!groups) {
    return groups
  }
  const index = groups.findIndex((candidate) => candidate.id === group.id)
  if (index === -1) {
    return [...groups, group]
  }
  const next = [...groups]
  next[index] = {...groups[index], ...group}
  return next
}

function remove(groups: Group[] | undefined, id: string): Group[] | undefined {
  return groups?.filter((group) => group.id !== id)
}

export function useViewGroups() {
  const queryClient = useQueryClient()

  const groups = useQuery({
    queryKey: groupsKey
    , queryFn: async() => (await groupsApi.getGroups()).groups
    , staleTime: 0
  })

  function setGroups(update: (groups: Group[] | undefined) => Group[] | undefined) {
    queryClient.setQueryData<Group[]>(groupsKey, update)
  }

  useSocketEvent(groupCreatedEvent, (message: GroupMessage) => {
    setGroups((current) => upsert(current, message.group))
  })

  useSocketEvent(groupDeletedEvent, (message: GroupMessage) => {
    setGroups((current) => remove(current, message.group.id))
  })

  useSocketEvent(groupUpdatedEvent, (message: GroupMessage) => {
    if (!message.group.users.includes(currentUser.email)) {
      setGroups((current) => remove(current, message.group.id))
      return
    }
    setGroups((current) => upsert(current, message.group))
    if (message.devices?.length) {
      queryClient.invalidateQueries({queryKey: groupDevicesKey(message.group.id)})
    }
    if (message.users?.length) {
      queryClient.invalidateQueries({queryKey: groupUsersKey(message.group.id)})
    }
  })

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    function invalidateSoon(members: 'users' | 'devices') {
      if (!timers.has(members)) {
        timers.set(members, setTimeout(() => {
          timers.delete(members)
          queryClient.invalidateQueries({queryKey: ['group-list', members]})
        }, memberInvalidationDelay))
      }
    }
    const invalidateUsers = () => invalidateSoon('users')
    const invalidateDevices = () => invalidateSoon('devices')
    const unsubscribers = [
      onSocket(userCreatedEvent, invalidateUsers)
      , onSocket(userDeletedEvent, invalidateUsers)
      , ...deviceSettingsEvents.map((event) => onSocket(event, invalidateDevices))
    ]
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      timers.forEach(clearTimeout)
    }
  }, [queryClient])

  return groups
}

export function useQuotaUser() {
  const queryClient = useQueryClient()

  const user = useQuery({
    queryKey: userKey
    , queryFn: async() => (await getUser()).user
    , staleTime: 0
  })

  useSocketEvent(userUpdatedEvent, (message: {user: User}) => {
    if (message.user?.email === currentUser.email) {
      queryClient.setQueryData(userKey, message.user)
    }
  })

  return user
}
