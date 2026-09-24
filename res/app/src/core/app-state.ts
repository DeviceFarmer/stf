export interface AdbKey {
  title: string
  fingerprint: string
}

export interface UserGroups {
  subscribed?: string[]
  lock?: boolean
  quotas?: {
    allocated?: {number: number, duration: number}
    consumed?: {number: number, duration: number}
    defaultGroupsNumber?: number
    defaultGroupsDuration?: number
    defaultGroupsRepetitions?: number
    repetitions?: number
  }
}

export interface User {
  email: string
  name: string
  privilege: 'admin' | 'user' | string
  ip?: string
  group?: string
  groups?: UserGroups
  settings: Record<string, unknown>
  adbKeys?: AdbKey[]
  createdAt?: string
  lastLoggedInAt?: string
  [key: string]: unknown
}

export interface AppConfig {
  websocketUrl: string
  stfVersion?: string
  userProfileUrl?: string
}

export interface AppState {
  config: AppConfig
  user: User
}

declare global {
  interface Window {
    GLOBAL_APPSTATE?: {
      config?: Partial<AppConfig>
      user?: Partial<User>
    }
  }
}

const injected = typeof window !== 'undefined' ? window.GLOBAL_APPSTATE : undefined

export const appState: AppState = {
  config: {
    websocketUrl: ''
    , ...injected?.config
  }
  , user: {
    email: ''
    , name: ''
    , privilege: 'user'
    , ...injected?.user
    , settings: {...injected?.user?.settings}
  }
}

export function isAdmin(): boolean {
  return appState.user.privilege === 'admin'
}
