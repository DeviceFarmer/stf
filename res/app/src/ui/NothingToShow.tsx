import type {ReactNode} from 'react'
import {Center, Stack, Text, ThemeIcon} from '@mantine/core'
import {IconMoodEmpty} from '@tabler/icons-react'

export function NothingToShow({message, icon, children}: {
  message: ReactNode
  icon?: ReactNode
  children?: ReactNode
}) {
  return (
    <Center py='xl' className='nothing-to-show'>
      <Stack align='center' gap='xs'>
        <ThemeIcon size={56} radius='xl' variant='light' color='gray'>
          {icon || <IconMoodEmpty size={30} />}
        </ThemeIcon>
        <Text c='dimmed' ta='center'>{message}</Text>
        {children}
      </Stack>
    </Center>
  )
}
