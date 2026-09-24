import {useState} from 'react'
import {Button, Group, TextInput, Title} from '@mantine/core'
import {IconUserPlus} from '@tabler/icons-react'
import {notifications} from '@mantine/notifications'
import {useTranslation} from '@/core/i18n'
import {usersApi} from '@/core/users-api'
import {withErrorModal} from '@/ui/modals'

export const userNameRegex = /^[0-9a-zA-Z-_. ]{1,50}$/
export const userNameRegexStr = String(userNameRegex)
const emailPattern = /^[^\s@]+@[^\s@]+$/

export function CreateUserForm({onCreated, className}: {onCreated: () => void, className?: string}) {
  const {t} = useTranslation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const nameValid = userNameRegex.test(name)
  const emailValid = emailPattern.test(email)

  async function save() {
    setSaving(true)
    let result
    try {
      result = await withErrorModal(() => usersApi.createUser(name, email))
    }
    finally {
      setSaving(false)
    }
    if (!result.error) {
      notifications.show({color: 'green', message: `${name} <${email}>`})
      setName('')
      setEmail('')
      onCreated()
    }
  }

  return (
    <div className={className}>
      <Group gap='xs' mb='sm'>
        <IconUserPlus size={16} />
        <Title order={6}>{t('Create new user')}</Title>
      </Group>
      <form
        name='userForm'
        onSubmit={(event) => {
          event.preventDefault()
          if (nameValid && emailValid && !saving) {
            save()
          }
        }}
      >
        <Group align='flex-start' gap='sm'>
          <TextInput
            size='xs'
            name='nameForm'
            label={t('Name')}
            required
            w={240}
            value={name}
            error={name && !nameValid ? `${t('Regex syntax')}: ${userNameRegexStr}` : null}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <TextInput
            size='xs'
            name='emailForm'
            type='email'
            label={t('Email')}
            required
            w={300}
            value={email}
            error={email && !emailValid ? true : null}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <Button
            type='submit'
            size='xs'
            variant='filled'
            mt={24}
            disabled={!nameValid || !emailValid}
            loading={saving}
          >
            {t('Save')}
          </Button>
        </Group>
      </form>
    </div>
  )
}
