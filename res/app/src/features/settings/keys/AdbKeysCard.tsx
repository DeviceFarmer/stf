import {useRef, useState, type FormEvent} from 'react'
import {Link} from 'react-router'
import {
  ActionIcon
  , Alert
  , Button
  , Code
  , Collapse
  , Group
  , Stack
  , Text
  , Textarea
  , TextInput
  , ThemeIcon
  , Tooltip
} from '@mantine/core'
import {
  IconBrandAndroid
  , IconBulb
  , IconDeviceLaptop
  , IconHelpCircle
  , IconKey
  , IconPlus
  , IconTrash
} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {useSocketEvent} from '@/core/socket'
import {addAdbKey, removeAdbKey, useAdbKeys} from '@/core/user'
import {CopyButton} from '@/ui/CopyButton'
import {NothingToShow} from '@/ui/NothingToShow'
import {WidgetCard} from '@/ui/WidgetCard'
import classes from './Keys.module.css'

const copyKeyCommand = 'pbcopy < ~/.android/adbkey.pub'

export function commentFromKey(key: string): string {
  return /.+= (.+)/.test(key) ? key.replace(/.+= (.+)/g, '$1') : ''
}

function focusAndSelect(element: HTMLInputElement | HTMLTextAreaElement | null) {
  requestAnimationFrame(() => {
    element?.focus()
    element?.select()
  })
}

function AddAdbKeyForm({onClose}: {onClose: () => void}) {
  const {t} = useTranslation()
  const [key, setKey] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const keyRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  function close() {
    setKey('')
    setTitle('')
    setError('')
    onClose()
  }

  useSocketEvent('user.keys.adb.added', close)
  useSocketEvent('user.keys.adb.error', (payload: {message?: string}) => {
    setError(payload?.message || t('Error'))
  })

  function changeKey(value: string) {
    setKey(value)
    if (value && !title) {
      setTitle(commentFromKey(value))
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    addAdbKey({title, key})
  }

  return (
    <form className={`stf-add-adb-key ${classes.panel}`} name='adbkeyform' onSubmit={submit}>
      <Text fw={600} size='sm' mb='sm'>{t('Add ADB Key')}</Text>
      <Stack gap='sm'>
        <Alert variant='light' color='blue' icon={<IconBulb size={18} />} p='xs' className='clip-board selectable'>
          <Text size='sm'>
            <Text span fw={600} size='sm'>{t('Tip:')}</Text> {t('Run this command to copy the key to your clipboard')}
          </Text>
          <div className={classes.command}>
            <Code>{copyKeyCommand}</Code>
            <CopyButton value={copyKeyCommand} variant='light' size='lg' onCopied={() => focusAndSelect(keyRef.current)} />
          </div>
        </Alert>
        <Textarea
          ref={keyRef}
          id='adb-device-key'
          name='deviceKey'
          label={t('Key')}
          required
          autosize
          minRows={4}
          maxRows={10}
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className={classes.mono}
          value={key}
          onChange={(event) => changeKey(event.currentTarget.value)}
          onPaste={() => focusAndSelect(titleRef.current)}
        />
        <TextInput
          ref={titleRef}
          id='adb-device-title'
          name='deviceTitle'
          label={t('Device')}
          leftSection={<IconDeviceLaptop size={16} />}
          required
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        {error && <Alert variant='light' color='red' p='xs' className='error-message'>{error}</Alert>}
        <Group justify='flex-end' gap='xs'>
          <Button variant='default' size='xs' onClick={close}>{t('Cancel')}</Button>
          <Button type='submit' size='xs' variant='filled' leftSection={<IconPlus size={14} />}>{t('Add Key')}</Button>
        </Group>
      </Stack>
    </form>
  )
}

export function AdbKeysCard() {
  const {t} = useTranslation()
  const keys = useAdbKeys((state) => state.keys)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <WidgetCard
      className='stf-keys stf-adb-keys'
      icon={IconBrandAndroid}
      title={t('ADB Keys')}
      actions={(
        <>
          <Tooltip label={t('More about ADB Keys')} withArrow>
            <ActionIcon
              component={Link}
              to='/docs/ADB-Keys'
              variant='subtle'
              color='gray'
              size='lg'
              aria-label={t('More about ADB Keys')}
            >
              <IconHelpCircle size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('Add ADB Key')} withArrow>
            <ActionIcon
              className='stf-add-adb-key-toggle'
              variant={showAdd ? 'filled' : 'light'}
              size='lg'
              aria-label={t('Add ADB Key')}
              aria-pressed={showAdd}
              onClick={() => setShowAdd(!showAdd)}
            >
              <IconPlus size={18} />
            </ActionIcon>
          </Tooltip>
        </>
      )}
    >
      <Collapse expanded={showAdd}>
        <AddAdbKeyForm onClose={() => setShowAdd(false)} />
      </Collapse>
      {!keys.length && !showAdd && (
        <NothingToShow icon={<IconBrandAndroid size={30} />} message={t('No ADB keys')} />
      )}
      {keys.length > 0 && (
        <ul className={`key-list ${classes.list}`}>
          {keys.map((key) => (
            <li key={key.fingerprint} className={classes.item}>
              <ThemeIcon variant='light' color='gray' size={36} radius='md'>
                <IconKey size={18} />
              </ThemeIcon>
              <div className={`key-list-details selectable ${classes.itemDetails}`}>
                <Text className='key-list-title' fw={500} size='sm' truncate>{key.title}</Text>
                <div className={`key-list-fingerprint ${classes.fingerprint}`}>{key.fingerprint}</div>
              </div>
              <Button
                className='key-list-remove'
                size='xs'
                variant='light'
                color='red'
                leftSection={<IconTrash size={14} />}
                onClick={() => removeAdbKey(key)}
              >
                {t('Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  )
}
