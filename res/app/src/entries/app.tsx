import {lazy, StrictMode, Suspense, type ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {createHashRouter, Navigate, useLocation} from 'react-router'
import {RouterProvider} from 'react-router/dom'
import {Center, Loader} from '@mantine/core'
import {startSettingsSync} from '@/core/settings'
import {startUserSync} from '@/core/user'
import {AppLayout, SectionContent} from '@/ui/AppLayout'
import {Providers} from '@/ui/Providers'
import {ControlRedirect} from '@/features/control/ControlRedirect'

const DeviceListPage = lazy(() => import('@/features/device-list/DeviceListPage'))
const GroupListPage = lazy(() => import('@/features/group-list/GroupListPage'))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'))
const ControlPage = lazy(() => import('@/features/control/ControlPage'))
const UserPage = lazy(() => import('@/features/user/UserPage'))
const DocsPage = lazy(() => import('@/features/docs/DocsPage'))

startSettingsSync()
startUserSync()

function Fallback() {
  const location = useLocation()
  const legacy = location.pathname.match(/^\/?!(\/.*)$/)
  return <Navigate to={legacy ? `${legacy[1]}${location.search}${location.hash}` : '/devices'} replace />
}

function page(node: ReactNode, section?: string) {
  return (
    <Suspense fallback={<Center className='fill-height'><Loader /></Center>}>
      <SectionContent name={section}>{node}</SectionContent>
    </Suspense>
  )
}

const router = createHashRouter([
  {
    element: <AppLayout />
    , children: [
      {index: true, element: <Navigate to='/devices' replace />}
      , {path: 'devices', element: page(<DeviceListPage />, 'devices')}
      , {path: 'groups', element: page(<GroupListPage />, 'groups')}
      , {path: 'settings/*', element: page(<SettingsPage />, 'settings')}
      , {path: 'control', element: <ControlRedirect />}
      , {path: 'control/:serial', element: page(<ControlPage />, 'control')}
      , {path: 'c/:serial', element: page(<ControlPage />, 'control')}
      , {path: 'user/*', element: page(<UserPage />)}
      , {path: 'docs/*', element: page(<DocsPage />)}
      , {path: 'help', element: page(<DocsPage />)}
      , {path: '*', element: <Fallback />}
    ]
  }
])

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>
)
