import {useState} from 'react'
import {Button, Group, Textarea} from '@mantine/core'
import {IconClipboardText, IconRefresh, IconSend} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import {createDeviceStore} from '@/core/device-store'
import {useTranslation} from '@/core/i18n'
import {CopyButton} from '@/ui/CopyButton'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import classes from '../Dashboard.module.css'

const clipboardStore = createDeviceStore<string>('')

export function ClipboardCard({control}: {control: Control}) {
  const {t} = useTranslation()
  const serial = control.target.serial
  const content = clipboardStore.useValue(serial)
  const [loading, setLoading] = useState(false)
  const [pasting, setPasting] = useState(false)

  function getClipboardContent() {
    setLoading(true)
    control.copy()
      .then((result) => {
        clipboardStore.set(serial, result.lastData || t('No clipboard data'))
      })
      .catch(() => {
        clipboardStore.set(serial, t('Error while getting data'))
      })
      .finally(() => setLoading(false))
  }

  function paste() {
    setPasting(true)
    control.paste(content)
      .catch(notifyFailure)
      .finally(() => setPasting(false))
  }

  return (
    <WidgetCard className='stf-clipboard' icon={IconClipboardText} color='orange' title={t('Clipboard')}>
      <Textarea
        classNames={{input: `clipboard-textarea ${classes.monoInput}`}}
        value={content}
        onChange={(event) => clipboardStore.set(serial, event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        autosize
        minRows={2}
        maxRows={8}
        tabIndex={20}
        spellCheck={false}
      />
      <Group justify='space-between' mt='sm' gap='xs'>
        <Group gap='xs'>
          <Button
            size='xs'
            leftSection={<IconRefresh size={14} />}
            loading={loading}
            onClick={getClipboardContent}
          >
            {t('Get clipboard contents')}
          </Button>
          <Button
            size='xs'
            variant='default'
            leftSection={<IconSend size={14} />}
            loading={pasting}
            disabled={!content}
            onClick={paste}
          >
            {t('Paste to device')}
          </Button>
        </Group>
        <CopyButton value={content} />
      </Group>
    </WidgetCard>
  )
}
