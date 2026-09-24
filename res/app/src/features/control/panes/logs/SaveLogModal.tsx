import {useMemo, useState} from 'react'
import {Button, Group, Select, Stack, Text, Textarea, TextInput} from '@mantine/core'
import {modals} from '@mantine/modals'
import {IconDeviceFloppy} from '@tabler/icons-react'
import {saveAs} from 'file-saver'
import {translate, useTranslation} from '@/core/i18n'
import {ModalTitle} from '@/ui/modals'
import {
  formatLogs
  , logExtensions
  , logFileName
  , logMimeTypes
  , type LogEntry
  , type LogExtension
} from './logcat'

const sampleLines = 4

function SaveLogForm({serial, entries, onDone}: {
  serial: string
  entries: LogEntry[]
  onDone: () => void
}) {
  const {t} = useTranslation()
  const [fileName, setFileName] = useState('')
  const [extension, setExtension] = useState<LogExtension>(logExtensions[0])
  const sample = useMemo(
    () => formatLogs(serial, entries, extension, sampleLines)
    , [serial, entries, extension]
  )

  function save() {
    const output = new Blob([formatLogs(serial, entries, extension)], {type: logMimeTypes[extension]})
    saveAs(output, logFileName(serial, fileName, extension))
    onDone()
  }

  return (
    <form
      className='stf-save-log-message'
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <Stack>
        <Group gap='xs' wrap='nowrap' align='center'>
          <TextInput
            name='saveLogFileName'
            placeholder={t('File Name')}
            value={fileName}
            onChange={(event) => setFileName(event.currentTarget.value)}
            style={{flex: 1}}
            data-autofocus
          />
          <Text c='dimmed' fw={600}>.</Text>
          <Select
            name='selectedExtension'
            w={96}
            data={logExtensions}
            value={extension}
            allowDeselect={false}
            onChange={(value) => value && setExtension(value as LogExtension)}
          />
        </Group>
        <Textarea
          className='save-log-textarea'
          label={t('Sample of log format')}
          value={sample}
          placeholder='...'
          readOnly
          autosize
          minRows={4}
          maxRows={8}
          styles={{input: {fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12}}}
        />
        <Group justify='flex-end'>
          <Button variant='default' onClick={onDone}>{t('Cancel')}</Button>
          <Button type='submit' variant='filled' leftSection={<IconDeviceFloppy size={16} />}>
            {t('Save Logs')}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function openSaveLogModal(serial: string, entries: LogEntry[]): void {
  const id = modals.open({
    title: <ModalTitle icon={IconDeviceFloppy} title={translate('Save Logs')} />
    , centered: true
    , size: 'lg'
    , children: <SaveLogForm serial={serial} entries={entries} onDone={() => modals.close(id)} />
  })
}
