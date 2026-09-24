import {Navigate} from 'react-router'
import {getSetting} from '@/core/settings'

export function ControlRedirect() {
  const lastUsedDevice = getSetting<string | undefined>('lastUsedDevice')
  return <Navigate to={lastUsedDevice ? `/control/${lastUsedDevice}` : '/'} replace />
}
