import type {ReactNode} from 'react'
import {MantineProvider} from '@mantine/core'
import {ModalsProvider} from '@mantine/modals'
import {Notifications} from '@mantine/notifications'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {theme} from './theme'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dropzone/styles.css'
import './global.css'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false
      , retry: 1
      , staleTime: 30000
    }
  }
})

export function Providers({children}: {children: ReactNode}) {
  return (
    <MantineProvider theme={theme} defaultColorScheme='auto'>
      <QueryClientProvider client={queryClient}>
        <ModalsProvider>
          <Notifications position='top-right' limit={5} />
          {children}
        </ModalsProvider>
      </QueryClientProvider>
    </MantineProvider>
  )
}
