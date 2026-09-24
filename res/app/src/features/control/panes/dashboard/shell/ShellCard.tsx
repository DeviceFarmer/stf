import {useRef, type KeyboardEvent} from 'react'
import {ActionIcon, Button, Loader, Text, TextInput} from '@mantine/core'
import {IconPlayerPlay, IconTerminal2, IconTrash} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import {useTranslation} from '@/core/i18n'
import {WidgetCard} from '@/ui/WidgetCard'
import {clearShell, runShell, setShellCommand, shellStore} from './shell-store'
import classes from '../Dashboard.module.css'

export function ShellCard({control}: {control: Control}) {
  const {t} = useTranslation()
  const serial = control.target.serial
  const shell = shellStore.useValue(serial)
  const historyIndex = useRef<number | null>(null)

  function submit() {
    if (shell.command) {
      historyIndex.current = null
      runShell(control, shell.command)
    }
  }

  function browseHistory(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !shell.history.length) {
      return
    }
    event.preventDefault()
    const last = shell.history.length - 1
    const current = historyIndex.current ?? shell.history.length
    const next = event.key === 'ArrowUp' ? Math.max(current - 1, 0) : current + 1
    if (next > last) {
      historyIndex.current = null
      setShellCommand(serial, '')
    }
    else {
      historyIndex.current = next
      setShellCommand(serial, shell.history[next])
    }
  }

  return (
    <WidgetCard
      className='stf-shell'
      icon={IconTerminal2}
      color='gray'
      title={t('Shell')}
      help={{topic: 'Remote-Shell', tooltip: t('Executes remote shell commands')}}
      actions={(
        <Button
          size='compact-xs'
          color='red'
          variant='subtle'
          leftSection={<IconTrash size={14} />}
          disabled={!shell.command && !shell.output && !shell.lastCommand}
          onClick={() => clearShell(serial)}
        >
          {t('Clear')}
        </Button>
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <TextInput
          value={shell.command}
          onChange={(event) => setShellCommand(serial, event.currentTarget.value)}
          onKeyDown={browseHistory}
          classNames={{input: `shell-input ${classes.monoInput}`}}
          leftSection={<Text span ff='monospace' c='dimmed' size='sm'>$</Text>}
          rightSectionWidth={40}
          rightSection={shell.running ?
            <Loader size='xs' /> :
            (
              <ActionIcon type='submit' variant='filled' disabled={!shell.command} aria-label={t('Run')}>
                <IconPlayerPlay size={14} />
              </ActionIcon>
            )}
          autoCapitalize='off'
          autoCorrect='off'
          autoComplete='off'
          spellCheck={false}
          accessKey='S'
          tabIndex={30}
        />
      </form>
      <div className={classes.terminal}>
        {shell.lastCommand ?
          <div className={classes.terminalPrompt}>$ {shell.lastCommand}</div> :
          <div className={classes.terminalHint}>{t('Executes remote shell commands')}</div>}
        {shell.output && (
          <pre className={`shell-results selectable ${classes.terminalOutput}`}>{shell.output}</pre>
        )}
        {shell.lastCommand !== null && !shell.running && !shell.output && (
          <pre className={`shell-results shell-results-empty ${classes.terminalOutput} ${classes.terminalEmpty}`}>
            {t('No output')}
          </pre>
        )}
        {shell.error && <div className={classes.terminalError}>{shell.error}</div>}
      </div>
    </WidgetCard>
  )
}
