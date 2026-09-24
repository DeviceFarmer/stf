import {useLocation} from 'react-router'
import {browserInfo} from '@/core/browser-info'
import {useSetting} from '@/core/settings'

export const basicMode = browserInfo.mobile

export function useStandalone(): boolean {
  const location = useLocation()
  return new URLSearchParams(location.search).has('standalone')
}

export function useAdminMode(): [boolean, (value: boolean) => void] {
  return useSetting<boolean>('adminMode', false)
}

export function usePlatform(): [string, (value: string) => void] {
  return useSetting<string>('platform', 'native')
}
