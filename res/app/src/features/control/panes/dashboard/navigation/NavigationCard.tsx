import {useRef, useState} from 'react'
import {Button, Group, Image, Text, TextInput, Tooltip, UnstyledButton} from '@mantine/core'
import {IconExternalLink, IconTrash, IconWorld} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import {createDeviceStore} from '@/core/device-store'
import type {Device, DeviceBrowserApp} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import classes from '../Dashboard.module.css'

const selectedBrowsers = createDeviceStore<string | null>(null)

function defaultBrowser(apps: DeviceBrowserApp[]): DeviceBrowserApp | undefined {
  return apps.find((app) => app.selected) ??
    apps.find((app) => app.name === 'Browser') ??
    apps[0]
}

function addHttp(textUrl: string): string {
  return (textUrl.replace(/\?.*/, '').indexOf('://') === -1 ? 'http://' : '') + textUrl
}

export function NavigationCard({device, control}: {device: Device, control: Control}) {
  const {t} = useTranslation()
  const apps = device.browser?.apps ?? []
  const selectedId = selectedBrowsers.useValue(device.serial)
  const browser = apps.find((app) => app.id === selectedId) ?? defaultBrowser(apps)
  const [textUrl, setTextUrl] = useState('')
  const [favicon, setFavicon] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  function openUrl() {
    if (!textUrl) {
      return
    }
    const url = addHttp(textUrl)
    setFavicon(`//www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}`)
    input.current?.blur()
    control.openBrowser(url, browser ? {...browser} : null).catch(notifyFailure)
  }

  function clearBrowser() {
    if (browser) {
      control.clearBrowser({...browser}).catch(notifyFailure)
    }
  }

  return (
    <WidgetCard
      className='stf-navigation'
      icon={IconWorld}
      color='blue'
      title={t('Navigation')}
      actions={(
        <Tooltip label={t('Reset all browser settings')}>
          <Button
            size='compact-xs'
            color='red'
            variant='subtle'
            leftSection={<IconTrash size={14} />}
            disabled={!browser}
            onClick={clearBrowser}
          >
            {t('Reset')}
          </Button>
        </Tooltip>
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          openUrl()
        }}
      >
        <Group gap='xs' wrap='nowrap'>
          <TextInput
            ref={input}
            className={classes.grow}
            name='textURL'
            placeholder='http://...'
            value={textUrl}
            onChange={(event) => {
              setTextUrl(event.currentTarget.value)
              setFavicon(null)
            }}
            onFocus={(event) => event.currentTarget.select()}
            leftSection={favicon ?
              <Image src={favicon} w={16} h={16} alt='' onError={() => setFavicon(null)} /> :
              <IconWorld size={16} />}
            autoComplete='url'
            autoCapitalize='off'
            spellCheck={false}
            accessKey='N'
            tabIndex={10}
          />
          <Button type='submit' variant='filled' disabled={!textUrl} leftSection={<IconExternalLink size={16} />}>
            {t('Open')}
          </Button>
        </Group>
      </form>
      {apps.length > 0 && (
        <Group gap='xs' mt='sm' className='browser-buttons'>
          {apps.map((app) => (
            <Tooltip key={app.id} label={`${app.name} (${app.developer})`}>
              <UnstyledButton
                className={classes.browserChip}
                data-active={app.id === browser?.id || undefined}
                aria-pressed={app.id === browser?.id}
                onClick={() => {
                  selectedBrowsers.set(device.serial, app.id)
                  input.current?.focus()
                }}
              >
                {app.type && (
                  <img
                    className='browser-icon'
                    src={`/static/app/browsers/icon/36x36/${app.type}.png`}
                    width={18}
                    height={18}
                    alt=''
                    onError={(event) => {
                      event.currentTarget.hidden = true
                    }}
                  />
                )}
                <Text span size='xs' fw={500}>{app.name}</Text>
              </UnstyledButton>
            </Tooltip>
          ))}
        </Group>
      )}
    </WidgetCard>
  )
}
