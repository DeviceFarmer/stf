import {useCallback, useState, type FormEvent} from 'react'
import {
  ActionIcon
  , Button
  , Group
  , Image
  , PasswordInput
  , Stack
  , Table
  , Text
  , TextInput
  , Tooltip
} from '@mantine/core'
import {useTimeout} from '@mantine/hooks'
import {IconCloud, IconLock, IconLogin, IconLogout, IconShoppingCart, IconUser} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import {useTranslation} from '@/core/i18n'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import type {PaneProps} from '../../types'
import {useDeviceValue} from '../use-device-value'

interface AppStore {
  type: string
  name: string
  package: string
}

const deviceAppStores: Record<string, AppStore> = {
  'google-play-store': {
    type: 'google-play-store'
    , name: 'Google Play Store'
    , package: 'com.google'
  }
}

export function StoreAccountCard({control}: Pick<PaneProps, 'control'>) {
  const {t} = useTranslation()
  const [currentAppStore, setCurrentAppStore] = useState('google-play-store')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [dirty, setDirty] = useState({username: false, password: false})
  const [addingAccount, setAddingAccount] = useState(false)
  const storeAccountType = deviceAppStores[currentAppStore]!.package
  const invalid = !username || !password
  const readAccounts = useCallback(
    (target: Control) => target.getAccounts(storeAccountType)
      .then((result): string[] => (Array.isArray(result.body) ? result.body : []))
    , [storeAccountType]
  )
  const storeAccounts = useDeviceValue(control, readAccounts)
  const accounts = storeAccounts.value ?? []
  const accountsRecheck = useTimeout(storeAccounts.reload, 500)

  function addAccount(event: FormEvent) {
    event.preventDefault()
    if (invalid) {
      return
    }
    setAddingAccount(true)
    control.addAccount(username, password)
      .catch((error) => {
        notifyFailure(error, t('Store Account'))
      })
      .finally(() => {
        setAddingAccount(false)
        accountsRecheck.clear()
        accountsRecheck.start()
      })
  }

  function removeAccount(account: string) {
    control.removeAccount(storeAccountType, account)
      .then(storeAccounts.reload)
      .catch((error) => {
        notifyFailure(error, t('Store Account'))
      })
  }

  return (
    <WidgetCard
      title={t('Store Account')}
      icon={IconCloud}
      color='cyan'
      className='stf-store-account'
      actions={(
        <Tooltip label={t('App Store')} position='bottom'>
          <ActionIcon variant='light' onClick={() => control.openStore().catch(notifyFailure)}>
            <IconShoppingCart size={16} />
          </ActionIcon>
        </Tooltip>
      )}
    >
      <Stack gap='md'>
        <form name='storeLogin' noValidate autoComplete='on' onSubmit={addAccount}>
          <Stack gap='sm'>
            <TextInput
              name='username'
              type='text'
              required
              placeholder={t('Username')}
              leftSection={<IconUser size={16} />}
              value={username}
              onChange={(event) => {
                setUsername(event.currentTarget.value)
                setDirty((state) => ({...state, username: true}))
              }}
              error={dirty.username && !username ? t('Please enter your Store username') : undefined}
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck={false}
              autoComplete='section-store-login username'
            />
            <PasswordInput
              name='password'
              required
              placeholder={t('Password')}
              leftSection={<IconLock size={16} />}
              value={password}
              onChange={(event) => {
                setPassword(event.currentTarget.value)
                setDirty((state) => ({...state, password: true}))
              }}
              error={dirty.password && !password ? t('Please enter your Store password') : undefined}
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck={false}
              autoComplete='section-store-login current-password'
            />
            <Group justify='space-between'>
              <Group gap={4}>
                {Object.entries(deviceAppStores).map(([id, store]) => (
                  <Tooltip key={id} label={store.name}>
                    <ActionIcon
                      variant={id === currentAppStore ? 'light' : 'default'}
                      size='lg'
                      aria-pressed={id === currentAppStore}
                      onClick={() => setCurrentAppStore(id)}
                    >
                      <Image
                        src={`/static/app/appstores/icon/24x24/${store.type}.png`}
                        w={16}
                        h={16}
                        alt={store.name}
                        className='appstore-icon'
                      />
                    </ActionIcon>
                  </Tooltip>
                ))}
              </Group>
              <Button
                type='submit'
                leftSection={<IconLogin size={16} />}
                disabled={invalid}
                loading={addingAccount}
              >
                {t('Sign In')}
              </Button>
            </Group>
          </Stack>
        </form>

        {accounts.length > 0 && (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('Account')}</Table.Th>
                <Table.Th w={1}>{t('Actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {accounts.map((account) => (
                <Table.Tr key={account}>
                  <Table.Td>
                    <Group gap='xs' wrap='nowrap'>
                      <IconUser size={16} />
                      <Text size='sm' className='selectable'>{account}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size='compact-xs'
                      color='red'
                      variant='outline'
                      leftSection={<IconLogout size={14} />}
                      onClick={() => removeAccount(account)}
                    >
                      {t('Sign Out')}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </WidgetCard>
  )
}
