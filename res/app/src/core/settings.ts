import {useCallback} from 'react'
import {create} from 'zustand'
import {appState} from './app-state'
import {mergeObject} from './collection'
import {emit, onSocket} from './socket'

type Settings = Record<string, any>

export const useSettingsStore = create<{settings: Settings}>(() => ({
  settings: {...appState.user.settings}
}))

function applyDelta(delta: Settings | null) {
  useSettingsStore.setState((state) => ({
    settings: delta ? mergeObject(state.settings, delta) : {}
  }))
}

let listening = false

export function startSettingsSync(): void {
  if (!listening) {
    listening = true
    onSocket('user.settings.update', applyDelta)
  }
}

export function updateSettings(delta: Settings): void {
  emit('user.settings.update', delta)
  applyDelta(delta)
}

export function setSetting(key: string, value: unknown): void {
  updateSettings({[key]: value})
}

export function getSetting<T>(key: string, defaultValue?: T): T {
  const value = useSettingsStore.getState().settings[key]
  return (value === undefined ? defaultValue : value) as T
}

export function resetSettings(): void {
  emit('user.settings.reset')
  applyDelta(null)
}

export function useSetting<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const stored = useSettingsStore((state) => state.settings[key]) as T | undefined
  const set = useCallback((value: T) => setSetting(key, value), [key])
  return [stored === undefined ? defaultValue : stored, set]
}
