import {useState} from 'react'
import {
  ActionIcon
  , Alert
  , Badge
  , Button
  , Collapse
  , Group
  , Paper
  , Progress
  , Stack
  , Text
  , TextInput
  , Tooltip
} from '@mantine/core'
import {Dropzone} from '@mantine/dropzone'
import {
  IconAlertTriangle
  , IconCircleCheck
  , IconCloudUpload
  , IconFileCode
  , IconLink
  , IconList
  , IconPackage
  , IconTrash
  , IconUpload
} from '@tabler/icons-react'
import type {Control} from '@/core/control'
import {useTranslation} from '@/core/i18n'
import {
  clearInstallation
  , installFailureText
  , installFile
  , installStateText
  , installUrl
  , installationStore
  , type Installation
} from '@/core/install'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import {ActivityLauncher} from './ActivityLauncher'
import classes from '../Dashboard.module.css'

function InstalledApp({control, installation}: {control: Control, installation: Installation}) {
  const {t} = useTranslation()
  const [showManifest, setShowManifest] = useState(false)
  const packageName = installation.manifest?.package

  function uninstall() {
    if (packageName) {
      control.uninstall(packageName)
        .then(() => clearInstallation(control.target.serial))
        .catch(notifyFailure)
    }
  }

  return (
    <Paper withBorder p='sm' radius='md'>
      <Stack gap='sm'>
        <Group justify='space-between' wrap='nowrap' gap='xs'>
          <Group gap='xs' wrap='nowrap' miw={0}>
            <IconCircleCheck size={18} color='var(--mantine-color-teal-6)' />
            <Text fw={600} size='sm' truncate className='selectable'>{packageName || 'App'}</Text>
          </Group>
          {installation.success && packageName && (
            <Button
              size='compact-xs'
              color='red'
              variant='light'
              leftSection={<IconTrash size={14} />}
              onClick={uninstall}
            >
              {t('Uninstall')}
            </Button>
          )}
        </Group>
        {installation.manifest && <ActivityLauncher control={control} manifest={installation.manifest} />}
        <div>
          <Button
            size='compact-xs'
            variant={showManifest ? 'filled' : 'default'}
            leftSection={<IconList size={14} />}
            onClick={() => setShowManifest((value) => !value)}
          >
            {showManifest ? t('Hide Manifest') : t('Show Manifest')}
          </Button>
          <Collapse expanded={showManifest}>
            <pre className={`${classes.manifest} selectable`}>
              {JSON.stringify(installation.manifest, null, 2)}
            </pre>
          </Collapse>
        </div>
      </Stack>
    </Paper>
  )
}

function InstallationStatus({control, installation}: {control: Control, installation: Installation}) {
  const {t} = useTranslation()
  const serial = control.target.serial

  if (installation.error) {
    return (
      <Alert
        color='red'
        variant='light'
        icon={<IconAlertTriangle size={18} />}
        title={t('Oops!')}
        withCloseButton
        onClose={() => clearInstallation(serial)}
        className='selectable'
      >
        {installFailureText(installation.error)}
      </Alert>
    )
  }

  if (installation.state === 'installed') {
    return <InstalledApp control={control} installation={installation} />
  }

  return (
    <Stack gap={6}>
      <Group justify='space-between' gap='xs'>
        <Text size='sm' fw={600}>{installStateText(installation.state)}</Text>
        <Badge variant='light' size='sm'>{installation.progress}%</Badge>
      </Group>
      <Progress value={installation.progress} striped animated={!installation.settled} size='md' radius='xl' />
    </Stack>
  )
}

export function InstallCard({control}: {control: Control}) {
  const {t} = useTranslation()
  const serial = control.target.serial
  const installation = installationStore.useValue(serial)
  const [remoteUrl, setRemoteUrl] = useState('')
  const busy = Boolean(installation && !installation.settled)

  function submitUrl() {
    if (remoteUrl) {
      installUrl(control, remoteUrl)
    }
  }

  return (
    <WidgetCard
      className='stf-upload'
      icon={IconUpload}
      color='red'
      title={t('App Upload')}
      actions={(
        <Button
          size='compact-xs'
          color='red'
          variant='subtle'
          leftSection={<IconTrash size={14} />}
          disabled={!installation}
          onClick={() => clearInstallation(serial)}
        >
          {t('Clear')}
        </Button>
      )}
    >
      <Stack gap='sm'>
        <Dropzone
          className={`${classes.dropzone} drop-area`}
          onDrop={(files) => installFile(control, files)}
          multiple={false}
          loading={busy}
          radius='md'
        >
          <Group justify='center' gap='sm' wrap='nowrap' className={classes.dropzoneContent}>
            <Dropzone.Accept>
              <IconCloudUpload size={32} color='var(--mantine-primary-color-filled)' />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconAlertTriangle size={32} color='var(--mantine-color-red-6)' />
            </Dropzone.Reject>
            <Dropzone.Idle>
              <IconPackage size={32} stroke={1.5} color='var(--mantine-color-dimmed)' />
            </Dropzone.Idle>
            <div>
              <Text size='sm' fw={500} className='drop-area-text'>{t('Drop file to upload')}</Text>
              <Text size='xs' c='dimmed'>
                {control.target.platform === 'iOS' ? '.ipa' : '.apk / .aab'}
              </Text>
            </div>
          </Group>
        </Dropzone>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submitUrl()
          }}
        >
          <TextInput
            size='sm'
            placeholder='http://...'
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.currentTarget.value)}
            leftSection={<IconLink size={16} />}
            rightSectionWidth={40}
            rightSection={(
              <Tooltip label={t('Upload From Link')}>
                <ActionIcon type='submit' variant='filled' disabled={!remoteUrl || busy} aria-label={t('Upload From Link')}>
                  <IconFileCode size={14} />
                </ActionIcon>
              </Tooltip>
            )}
            autoCapitalize='off'
            spellCheck={false}
            autoComplete='url'
          />
        </form>
        {installation && (
          <div className='upload-status'>
            <InstallationStatus control={control} installation={installation} />
          </div>
        )}
      </Stack>
    </WidgetCard>
  )
}
