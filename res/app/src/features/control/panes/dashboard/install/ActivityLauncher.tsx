import {useMemo, useState} from 'react'
import {Autocomplete, Button, Group, SimpleGrid} from '@mantine/core'
import {IconPlayerPlay} from '@tabler/icons-react'
import uniq from 'lodash/uniq'
import type {Control} from '@/core/control'
import {useTranslation} from '@/core/i18n'
import type {Manifest, ManifestIntentData} from '@/core/install'
import {notifyFailure} from '@/ui/notify'

function dataUri(data: ManifestIntentData): string {
  let uri = `${data.scheme}://`
  if (data.host) {
    uri += data.host
  }
  if (data.port) {
    uri += data.port
  }
  const path = data.path || data.pathPrefix || data.pathPattern
  if (path) {
    uri += `/${path}`
  }
  return uri
}

function collectOptions(manifest: Manifest) {
  const activities = manifest.application?.activities
  const names: string[] = []
  const actions: string[] = []
  const categories: string[] = []
  const data: string[] = []

  for (const activity of Array.isArray(activities) ? activities : []) {
    if (activity.name) {
      names.push(activity.name)
    }
    for (const filter of activity.intentFilters ?? []) {
      for (const action of filter.actions ?? []) {
        if (action.name) {
          actions.push(action.name)
        }
      }
      for (const category of filter.categories ?? []) {
        if (category.name) {
          categories.push(category.name)
        }
      }
      for (const entry of filter.data ?? []) {
        if (entry.scheme) {
          data.push(dataUri(entry))
        }
        if (entry.mimeType) {
          data.push(entry.mimeType)
        }
      }
    }
  }

  return {
    names: uniq(names)
    , actions: uniq(actions)
    , categories: uniq(categories)
    , data: uniq(data)
  }
}

export function ActivityLauncher({control, manifest}: {control: Control, manifest: Manifest}) {
  const {t} = useTranslation()
  const options = useMemo(() => collectOptions(manifest), [manifest])
  const [packageName, setPackageName] = useState(manifest.package || '')
  const [activityName, setActivityName] = useState('')
  const [action, setAction] = useState('')
  const [category, setCategory] = useState('')
  const [data, setData] = useState('')

  function runActivity() {
    let command = 'am start'
    if (action) {
      command += ` -a ${action}`
    }
    if (category) {
      command += ` -c ${category}`
    }
    if (data) {
      command += ` -d ${data}`
    }
    if (packageName && activityName) {
      command += ` -n ${packageName}/${activityName}`
    }
    control.shell(command).catch(notifyFailure)
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        runActivity()
      }}
    >
      <SimpleGrid type='container' cols={{base: 1, '420px': 2}} spacing='xs' verticalSpacing='xs'>
        <Autocomplete
          size='xs'
          label={t('Package')}
          value={packageName}
          onChange={setPackageName}
          data={manifest.package ? [manifest.package] : []}
        />
        <Autocomplete size='xs' label={t('Activity')} value={activityName} onChange={setActivityName} data={options.names} />
        <Autocomplete size='xs' label={t('Action')} value={action} onChange={setAction} data={options.actions} />
        <Autocomplete
          size='xs'
          label={t('Category')}
          value={category}
          onChange={setCategory}
          data={options.categories}
        />
        <Autocomplete size='xs' label={t('Data')} value={data} onChange={setData} data={options.data} />
      </SimpleGrid>
      <Group justify='flex-end' mt='sm'>
        <Button type='submit' size='xs' leftSection={<IconPlayerPlay size={14} />}>
          {t('Launch Activity')}
        </Button>
      </Group>
    </form>
  )
}
