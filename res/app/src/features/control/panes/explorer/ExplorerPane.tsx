import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent} from 'react'
import {
  ActionIcon
  , Alert
  , Box
  , Anchor
  , Breadcrumbs
  , Group
  , Loader
  , Paper
  , Stack
  , Table
  , Text
  , TextInput
  , UnstyledButton
} from '@mantine/core'
import {
  IconAlertCircle
  , IconCornerLeftUp
  , IconDownload
  , IconFolderOpen
  , IconFolderRoot
  , IconPlayerPlay
} from '@tabler/icons-react'
import {createDeviceStore} from '@/core/device-store'
import {translate, useTranslation} from '@/core/i18n'
import {errorMessage} from '@/ui/modals'
import {NothingToShow} from '@/ui/NothingToShow'
import {notifyFailure} from '@/ui/notify'
import type {PaneProps} from '../../types'
import {
  compareEntries
  , fileIcon
  , fileIsDir
  , formatFileDate
  , formatFileSize
  , formatPermissionMode
  , normalizePath
  , type FileEntry
} from './fileUtils'
import classes from './ExplorerPane.module.css'

const explorerPaths = createDeviceStore<string>('/')

function cleanPath(path: string): string {
  const normalized = normalizePath(path)
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}

function parentPath(path: string): string {
  return cleanPath(path.split('/').slice(0, -1).join('/'))
}

function saveFile(href: string, name: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function PathBreadcrumbs({path, onOpen}: {path: string, onOpen: (path: string) => void}) {
  const segments = path.split('/').filter(Boolean)
  return (
    <Breadcrumbs separatorMargin={4} className={classes.breadcrumbs}>
      <Anchor component='button' type='button' size='sm' onClick={() => onOpen('/')} className={classes.crumb}>
        <IconFolderRoot size={16} />
      </Anchor>
      {segments.map((segment, index) => {
        const target = `/${segments.slice(0, index + 1).join('/')}`
        return index === segments.length - 1 ?
          <Text key={target} size='sm' fw={600}>{segment}</Text> :
          <Anchor key={target} component='button' type='button' size='sm' onClick={() => onOpen(target)}>
            {segment}
          </Anchor>
      })}
    </Breadcrumbs>
  )
}

function EntryName({entry, busy, onOpen}: {entry: FileEntry, busy: boolean, onOpen: () => void}) {
  const {icon: Icon, color} = fileIcon(entry)
  const directory = fileIsDir(entry.mode)
  return (
    <UnstyledButton onClick={onOpen} className={classes.name} data-directory={directory || undefined}>
      <Group gap='xs' wrap='nowrap'>
        <Box c={`${color}.6`} className={classes.icon}>
          <Icon size={18} />
        </Box>
        <Text size='sm' fw={directory ? 500 : 400} className={classes.nameText}>{entry.name}</Text>
        {busy && <Loader size={14} />}
        {!directory && !busy && <IconDownload size={14} className={classes.downloadHint} />}
      </Group>
    </UnstyledButton>
  )
}

export default function ExplorerPane({device, control}: PaneProps) {
  const {t} = useTranslation()
  const serial = device.serial
  const path = explorerPaths.useValue(serial)
  const [search, setSearch] = useState(path)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retrieving, setRetrieving] = useState<Record<string, boolean>>({})
  const requestId = useRef(0)

  const listDir = useCallback((target: string) => {
    const dir = cleanPath(target)
    const id = ++requestId.current
    explorerPaths.set(serial, dir)
    setSearch(dir)
    setLoading(true)
    setError(null)
    control.fslist(dir)
      .then((result) => {
        if (id === requestId.current) {
          setFiles(Array.isArray(result.body) ? result.body : [])
        }
      })
      .catch((err) => {
        if (id === requestId.current) {
          setFiles([])
          setError(errorMessage(err))
        }
      })
      .finally(() => {
        if (id === requestId.current) {
          setLoading(false)
        }
      })
  }, [control, serial])

  useEffect(() => {
    listDir(explorerPaths.get(serial))
  }, [listDir, serial])

  const sorted = useMemo(() => files.slice().sort(compareEntries), [files])

  function dirEnterLocation(event: FormEvent) {
    event.preventDefault()
    if (search) {
      listDir(search)
    }
  }

  function getFile(name: string) {
    const file = cleanPath(`${path}/${name}`)
    setRetrieving((state) => ({...state, [file]: true}))
    control.fsretrieve(file)
      .then((result) => {
        if (result.body) {
          saveFile(result.body.href, name)
        }
      })
      .catch((err) => {
        notifyFailure(err, translate('Failed to download file'))
      })
      .finally(() => {
        setRetrieving((state) => {
          const next = {...state}
          delete next[file]
          return next
        })
      })
  }

  function openEntry(entry: FileEntry) {
    if (fileIsDir(entry.mode)) {
      listDir(`${path}/${entry.name}`)
    }
    else {
      getFile(entry.name)
    }
  }

  return (
    <Stack gap='sm' className='stf-explorer'>
      <Paper withBorder p='xs' className={classes.toolbar}>
        <Stack gap={6}>
          <form name='explorerForm' onSubmit={dirEnterLocation}>
            <Group gap='xs' wrap='nowrap'>
              <ActionIcon
                variant='default'
                size='lg'
                onClick={() => listDir(parentPath(path))}
                disabled={path === '/'}
                className='stf-explorer-up'
              >
                <IconCornerLeftUp size={18} />
              </ActionIcon>
              <TextInput
                className={classes.location}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                leftSection={<IconFolderOpen size={16} />}
                rightSection={loading ? <Loader size={14} /> : undefined}
                autoCorrect='off'
                autoCapitalize='off'
                spellCheck={false}
                autoComplete='off'
                name='path'
                styles={{input: {fontFamily: 'var(--mantine-font-family-monospace)'}}}
              />
              <ActionIcon type='submit' variant='filled' size='lg' className='stf-explorer-go'>
                <IconPlayerPlay size={16} />
              </ActionIcon>
            </Group>
          </form>
          <PathBreadcrumbs path={path} onOpen={listDir} />
        </Stack>
      </Paper>

      {error && (
        <Alert color='red' variant='light' icon={<IconAlertCircle size={18} />} title={t('Error')}>
          {error}
        </Alert>
      )}

      <Paper withBorder className={`selectable ${classes.listing}`}>
        <Table.ScrollContainer minWidth={560} type='native'>
          <Table striped highlightOnHover verticalSpacing={6} className='stf-explorer-table'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('Name')}</Table.Th>
                <Table.Th w={100}>{t('Size')}</Table.Th>
                <Table.Th w={190}>{t('Date')}</Table.Th>
                <Table.Th w={130}>{t('Permissions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sorted.map((entry) => (
                <Table.Tr key={entry.name} data-name={entry.name}>
                  <Table.Td>
                    <EntryName
                      entry={entry}
                      busy={Boolean(retrieving[cleanPath(`${path}/${entry.name}`)])}
                      onOpen={() => openEntry(entry)}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm' c='dimmed' className={classes.nowrap}>
                      {fileIsDir(entry.mode) ? '-' : formatFileSize(entry.size)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm' c='dimmed' ff='monospace' className={classes.nowrap}>
                      {formatFileDate(entry.mtimeMs ?? entry.mtime)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm' ff='monospace' fs='italic' className={classes.nowrap}>
                      {formatPermissionMode(entry.mode)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!loading && !error && sorted.length === 0 && (
          <NothingToShow message={t('This folder is empty')} icon={<IconFolderOpen size={30} />} />
        )}
      </Paper>
    </Stack>
  )
}
