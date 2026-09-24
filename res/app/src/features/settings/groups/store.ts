import {useEffect} from 'react'
import {create} from 'zustand'
import {notifications} from '@mantine/notifications'
import {appState} from '@/core/app-state'
import {
  addItem
  , addItems
  , getItem
  , hasItem
  , listOf
  , mergeObject
  , removeItem
  , updateItem
  , type Collection
} from '@/core/collection'
import {devicesApi, deviceSettingsEvents} from '@/core/devices-api'
import {groupSettingsEvents, groupsApi, type Group} from '@/core/groups-api'
import {onSocket} from '@/core/socket'
import {getUser} from '@/core/user'
import {userSettingsEvents, usersApi, userViewEvents} from '@/core/users-api'
import {errorMessage} from '@/ui/modals'
import {isAdminUser, isOriginGroup} from './rules'
import {groupDeviceFields, userFields, type ConflictRow, type SettingsDevice, type SettingsUser} from './types'

interface TransientDevices {
  groupId: string | null
  devices: Collection<SettingsDevice>
  loading: boolean
}

interface GroupsState {
  groups: Collection<Group>
  users: Collection<SettingsUser>
  originDevices: Collection<SettingsDevice>
  standardizableDevices: Collection<SettingsDevice>
  transient: TransientDevices
  conflicts: Record<string, ConflictRow[]>
  currentUser: SettingsUser
  loadingGroups: boolean
}

interface GroupChangeMessage {
  group: Group
  timeStamp: number
  isChangedDates: boolean
  isChangedClass: boolean
  isAddedDevice: boolean
  devices: string[]
}

interface UserChangeMessage {
  user: SettingsUser
  groups: string[]
  timeStamp: number
}

interface DeviceChangeMessage {
  device: SettingsDevice
  oldOriginGroupId: string
  timeStamp: number
}

function initialState(): GroupsState {
  return {
    groups: {}
    , users: {}
    , originDevices: {}
    , standardizableDevices: {}
    , transient: {groupId: null, devices: {}, loading: false}
    , conflicts: {}
    , currentUser: mergeObject({email: '', name: '', privilege: 'user'}, appState.user)
    , loadingGroups: true
  }
}

export const useGroupsStore = create<GroupsState>(() => initialState())

const set = useGroupsStore.setState
const get = useGroupsStore.getState
const classCache: Record<string, string> = {}
let transientRequest = 0

function showLoadError(error: unknown) {
  notifications.show({color: 'red', message: errorMessage(error)})
}

function bookedSerials(groups: Collection<Group>): Set<string> {
  const serials = new Set<string>()
  for (const group of listOf(groups)) {
    if (!isOriginGroup(group.class)) {
      group.devices.forEach((serial) => serials.add(serial))
    }
  }
  return serials
}

function addStandardizableIfNotBooked(
  state: Pick<GroupsState, 'groups' | 'originDevices' | 'standardizableDevices'>
, serials: string[]
, timeStamp: number
): Collection<SettingsDevice> {
  let standardizable = state.standardizableDevices
  const booked = bookedSerials(state.groups)
  for (const serial of serials) {
    const device = getItem(state.originDevices, serial)
    if (device && !booked.has(serial)) {
      standardizable = addItem(standardizable, serial, device, timeStamp).collection
    }
  }
  return standardizable
}

function fetchTransient(groupId: string, request: number, reportErrors: boolean) {
  groupsApi.getGroupDevices(groupId, true, groupDeviceFields)
    .then((response) => {
      if (request === transientRequest && get().transient.groupId === groupId) {
        set({
          transient: {
            groupId
            , devices: addItems({}, response.devices as SettingsDevice[], (device) => device.serial, -1)
            , loading: false
          }
        })
      }
    })
    .catch((error) => {
      if (request === transientRequest) {
        set((state) => ({transient: {...state.transient, loading: false}}))
        if (reportErrors) {
          showLoadError(error)
        }
      }
    })
}

export function watchTransientDevices(groupId: string | null): void {
  transientRequest += 1
  set({transient: {groupId, devices: {}, loading: Boolean(groupId)}})
  if (groupId) {
    fetchTransient(groupId, transientRequest, true)
  }
}

function refreshTransient(predicate: (group: Group) => boolean) {
  const {transient, groups} = get()
  const group = transient.groupId ? getItem(groups, transient.groupId) : undefined
  if (group && !isOriginGroup(group.class) && predicate(group)) {
    transientRequest += 1
    fetchTransient(group.id, transientRequest, false)
  }
}

function updateTransient(change: (devices: Collection<SettingsDevice>) => Collection<SettingsDevice>) {
  const {transient, groups} = get()
  const group = transient.groupId ? getItem(groups, transient.groupId) : undefined
  if (group && !isOriginGroup(group.class)) {
    set({transient: {...transient, devices: change(transient.devices)}})
  }
}

function groupClassOf(id: string): Promise<string | false> {
  const group = getItem(get().groups, id)
  if (group) {
    return Promise.resolve(group.class)
  }
  if (classCache[id]) {
    return Promise.resolve(classCache[id])
  }
  return groupsApi.getGroup(id)
    .then((response) => {
      classCache[id] = response.group.class
      return classCache[id]
    })
    .catch(() => false as const)
}

export function loadGroupsSettings(): void {
  set(initialState())
  groupsApi.getMyGroups()
    .then((response) => {
      for (const group of response.groups) {
        classCache[group.id] = group.class
      }
      set((state) => ({groups: addItems(state.groups, response.groups, (group) => group.id, -1), loadingGroups: false}))
    })
    .catch((error) => {
      set({loadingGroups: false})
      showLoadError(error)
    })
  usersApi.getUsers(userFields)
    .then((response) => {
      set((state) => ({
        users: addItems(state.users, response.users as SettingsUser[], (user) => user.email, -1)
      }))
    })
    .catch(showLoadError)
  getUser()
    .then((response) => {
      set((state) => ({currentUser: mergeObject(state.currentUser, response.user)}))
    })
    .catch(showLoadError)
  if (isAdminUser(appState.user)) {
    devicesApi.getDevices('origin', groupDeviceFields)
      .then((response) => {
        set((state) => ({
          originDevices: addItems(state.originDevices, response.devices as SettingsDevice[], (d) => d.serial, -1)
        }))
      })
      .catch(showLoadError)
    devicesApi.getDevices('standardizable', groupDeviceFields)
      .then((response) => {
        set((state) => ({
          standardizableDevices: addItems(
            state.standardizableDevices
            , response.devices as SettingsDevice[]
            , (device) => device.serial
            , -1
          )
        }))
      })
      .catch(showLoadError)
  }
}

export function setGroupConflicts(groupId: string, rows: ConflictRow[]): void {
  set((state) => ({conflicts: {...state.conflicts, [groupId]: rows}}))
}

export function clearGroupConflicts(groupId: string): void {
  set((state) => {
    const conflicts = {...state.conflicts}
    delete conflicts[groupId]
    return {conflicts}
  })
}

function onGroupUpdated(message: GroupChangeMessage) {
  const state = get()
  const admin = isAdminUser(state.currentUser)
  const isChangedSchedule = message.isChangedDates || message.isChangedClass
  const doGetDevices = !isOriginGroup(message.group.class) && (isChangedSchedule || message.devices.length > 0)
  const isGroupOwner = admin || state.currentUser.email === message.group.owner.email
  const {collection: groups, item: group} = updateItem(
    state.groups
    , message.group.id
    , message.group
    , message.timeStamp
    , !isGroupOwner
  )

  if (group) {
    classCache[group.id] = group.class
    let standardizableDevices = state.standardizableDevices
    if (admin && !isOriginGroup(group.class) && message.devices.length) {
      if (!message.isAddedDevice) {
        standardizableDevices = addStandardizableIfNotBooked(
          {...state, groups}
          , message.devices
          , message.timeStamp
        )
      }
      else {
        for (const serial of message.devices) {
          standardizableDevices = removeItem(standardizableDevices, serial, message.timeStamp).collection
        }
      }
    }
    set({groups, standardizableDevices})
    if (doGetDevices) {
      refreshTransient((candidate) => candidate.id !== message.group.id || isChangedSchedule)
    }
  }
  else if (!isGroupOwner && doGetDevices) {
    refreshTransient(() => true)
  }
}

function onGroupCreated(message: GroupChangeMessage) {
  classCache[message.group.id] = message.group.class
  set((state) => ({groups: addItem(state.groups, message.group.id, message.group, message.timeStamp).collection}))
}

function onGroupDeleted(message: GroupChangeMessage) {
  const state = get()
  const group = message.group
  const {collection: groups, item} = removeItem(state.groups, group.id, message.timeStamp)
  let standardizableDevices = state.standardizableDevices
  if (item && isAdminUser(state.currentUser) && !isOriginGroup(group.class)) {
    standardizableDevices = addStandardizableIfNotBooked({...state, groups}, group.devices, message.timeStamp)
  }
  const conflicts = {...state.conflicts}
  delete conflicts[group.id]
  set({groups, standardizableDevices, conflicts})
  if (!isOriginGroup(group.class) && group.devices.length) {
    refreshTransient(() => true)
  }
}

function onUserUpdated(message: UserChangeMessage) {
  const state = get()
  const email = message.user.email
  const isCurrentUser = email === state.currentUser.email
  if (!(isAdminUser(state.currentUser) && hasItem(state.users, email) || isCurrentUser)) {
    return
  }
  const {collection: users} = updateItem(state.users, email, message.user, message.timeStamp)
  set({
    users
    , currentUser: isCurrentUser ? mergeObject(state.currentUser, message.user) : state.currentUser
  })
  if (!message.groups?.length) {
    return
  }
  Promise.all(message.groups.map(groupClassOf)).then((classes) => {
    if (classes.some((groupClass) => !groupClass || groupClass === 'bookable')) {
      refreshTransient((group) => group.owner.email === email)
    }
  })
}

function onUserCreated(message: UserChangeMessage) {
  set((state) => ({users: addItem(state.users, message.user.email, message.user, message.timeStamp).collection}))
}

function onUserDeleted(message: UserChangeMessage) {
  set((state) => ({users: removeItem(state.users, message.user.email, message.timeStamp).collection}))
}

function onDeviceDeleted(message: DeviceChangeMessage) {
  const serial = message.device.serial
  if (isAdminUser(get().currentUser)) {
    set((state) => ({
      originDevices: removeItem(state.originDevices, serial, message.timeStamp).collection
      , standardizableDevices: removeItem(state.standardizableDevices, serial, message.timeStamp).collection
    }))
  }
  updateTransient((devices) => removeItem(devices, serial, message.timeStamp).collection)
}

function onDeviceCreated(message: DeviceChangeMessage) {
  const device = message.device
  if (isAdminUser(get().currentUser)) {
    set((state) => ({
      originDevices: addItem(state.originDevices, device.serial, device, message.timeStamp).collection
      , standardizableDevices: addItem(state.standardizableDevices, device.serial, device, message.timeStamp).collection
    }))
  }
}

function onDeviceUpdated(message: DeviceChangeMessage) {
  const device = message.device
  const state = get()
  if (isAdminUser(state.currentUser)) {
    const originDevices = updateItem(state.originDevices, device.serial, device, message.timeStamp).collection
    const booked = hasItem(originDevices, device.serial) && bookedSerials(state.groups).has(device.serial)
    const standardizableDevices = booked ?
      state.standardizableDevices :
      updateItem(state.standardizableDevices, device.serial, device, message.timeStamp).collection
    set({originDevices, standardizableDevices})
  }
  const origin = device.group?.origin
  if (origin !== message.oldOriginGroupId) {
    if (origin && get().currentUser.groups?.subscribed?.includes(origin)) {
      refreshTransient(() => true)
    }
    else {
      updateTransient((devices) => removeItem(devices, device.serial, message.timeStamp).collection)
    }
  }
  else {
    updateTransient((devices) => updateItem(devices, device.serial, device, message.timeStamp, true).collection)
  }
}

const [groupCreatedEvent, groupDeletedEvent, groupUpdatedEvent] = groupSettingsEvents
const [userCreatedEvent, userDeletedEvent, userUpdatedEvent] = userSettingsEvents
const [userViewUpdatedEvent] = userViewEvents
const [deviceCreatedEvent, deviceDeletedEvent, deviceUpdatedEvent] = deviceSettingsEvents

const handlers: Record<string, (message: any) => void> = {
  [groupCreatedEvent]: onGroupCreated
  , [groupDeletedEvent]: onGroupDeleted
  , [groupUpdatedEvent]: onGroupUpdated
  , [userCreatedEvent]: onUserCreated
  , [userDeletedEvent]: onUserDeleted
  , [userUpdatedEvent]: onUserUpdated
  , [userViewUpdatedEvent]: onUserUpdated
  , [deviceCreatedEvent]: onDeviceCreated
  , [deviceDeletedEvent]: onDeviceDeleted
  , [deviceUpdatedEvent]: onDeviceUpdated
}

export function useGroupsSettingsSync(): void {
  useEffect(() => {
    const unsubscribers = Object.entries(handlers).map(([event, handler]) => onSocket(event, handler))
    loadGroupsSettings()
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
      watchTransientDevices(null)
    }
  }, [])
}
