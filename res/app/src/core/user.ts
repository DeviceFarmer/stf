import {create} from 'zustand'
import {api} from './api'
import {appState, type AdbKey, type User} from './app-state'
import {emit, onSocket} from './socket'

export const currentUser: User = appState.user

export const useAdbKeys = create<{keys: AdbKey[]}>(() => ({
  keys: appState.user.adbKeys || []
}))

let listening = false

export function startUserSync(): void {
  if (listening) {
    return
  }
  listening = true
  onSocket('user.keys.adb.added', (key: AdbKey) => {
    useAdbKeys.setState((state) => ({keys: [...state.keys, key]}))
  })
  onSocket('user.keys.adb.removed', (key: AdbKey) => {
    useAdbKeys.setState((state) => ({
      keys: state.keys.filter((someKey) => someKey.fingerprint !== key.fingerprint)
    }))
  })
}

export function getUser(): Promise<{user: User}> {
  return api.get('/api/v1/user')
}

export function addAdbKey(key: {title: string, key: string}): void {
  emit('user.keys.adb.add', key)
}

export function acceptAdbKey(key: unknown): void {
  emit('user.keys.adb.accept', key)
}

export function removeAdbKey(key: AdbKey): void {
  emit('user.keys.adb.remove', key)
}
