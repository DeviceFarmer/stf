import type {ReactNode} from 'react'
import {MantineProvider} from '@mantine/core'
import {theme} from './theme'
import '@mantine/core/styles/baseline.css'
import '@mantine/core/styles/default-css-variables.css'
import '@mantine/core/styles/global.css'
import '@mantine/core/styles/UnstyledButton.css'
import '@mantine/core/styles/Paper.css'
import '@mantine/core/styles/Loader.css'
import '@mantine/core/styles/ActionIcon.css'
import '@mantine/core/styles/Group.css'
import '@mantine/core/styles/Input.css'
import '@mantine/core/styles/Alert.css'
import '@mantine/core/styles/Text.css'
import '@mantine/core/styles/Anchor.css'
import '@mantine/core/styles/Button.css'
import '@mantine/core/styles/Center.css'
import '@mantine/core/styles/Image.css'
import '@mantine/core/styles/PasswordInput.css'
import '@mantine/core/styles/Tooltip.css'
import '@mantine/core/styles/Stack.css'
import '@mantine/core/styles/Title.css'
import './global.css'

export function AuthProviders({children}: {children: ReactNode}) {
  return (
    <MantineProvider theme={theme} defaultColorScheme='auto'>
      {children}
    </MantineProvider>
  )
}
