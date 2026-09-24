import {useParams} from 'react-router'
import {
  Anchor
  , Avatar
  , Badge
  , Button
  , Center
  , Group
  , Loader
  , Paper
  , Stack
  , Text
  , Title
} from '@mantine/core'
import {IconMail, IconUserQuestion} from '@tabler/icons-react'
import {useQuery} from '@tanstack/react-query'
import {appState} from '@/core/app-state'
import {useTranslation} from '@/core/i18n'
import {usersApi} from '@/core/users-api'
import {NothingToShow} from '@/ui/NothingToShow'
import {Page} from '@/ui/Page'
import {usePageTitle} from '@/ui/page-title'
import classes from './UserPage.module.css'

function decodeEmail(path: string | undefined): string {
  try {
    return decodeURIComponent(path || '')
  }
  catch {
    return path || ''
  }
}

export default function UserPage() {
  const {t} = useTranslation()
  const email = decodeEmail(useParams()['*'])
  const isMe = email === appState.user.email

  const {data: user, isPending, isError} = useQuery({
    queryKey: ['user-profile', email]
    , queryFn: async() => (await usersApi.getUser(email, 'email,name,privilege')).user
    , enabled: email !== ''
    , retry: false
  })

  usePageTitle(user?.name || t('User'))

  function renderProfile() {
    if (email && isPending) {
      return <Center py='xl'><Loader /></Center>
    }
    if (!email || isError || !user) {
      return (
        <NothingToShow icon={<IconUserQuestion size={30} />} message={t('Not Found')}>
          {email && <Text size='sm' c='dimmed' className='selectable'>{email}</Text>}
        </NothingToShow>
      )
    }
    return (
      <Stack align='center' gap='md' className='stf-user-profile'>
        <Avatar name={user.name || user.email} color='initials' size={96} radius='50%' />
        <Stack align='center' gap={4}>
          <Title order={2} ta='center' className='selectable user-name'>{user.name || user.email}</Title>
          <Anchor href={`mailto:${user.email}`} c='dimmed' className='selectable user-email'>
            {user.email}
          </Anchor>
        </Stack>
        <Group gap='xs' justify='center'>
          <Badge variant='light' color={user.privilege === 'admin' ? 'grape' : 'gray'} className='user-privilege'>
            {user.privilege}
          </Badge>
          {isMe && <Badge variant='light' color='teal'>{t('You')}</Badge>}
        </Group>
        <Button
          component='a'
          href={`mailto:${user.email}`}
          leftSection={<IconMail size={16} />}
          mt='xs'
        >
          {t('Email')}
        </Button>
      </Stack>
    )
  }

  return (
    <Page className='stf-user' innerClassName={classes.inner} maxWidth={560}>
      <Text size='sm' fw={600} c='dimmed' tt='uppercase' mb='sm'>{t('User')}</Text>
      <Paper withBorder shadow='xs' className={classes.card}>
        {renderProfile()}
      </Paper>
    </Page>
  )
}
