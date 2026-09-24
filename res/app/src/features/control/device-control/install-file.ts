import {notifications} from '@mantine/notifications'
import type {Control} from '@/core/control'
import {translate} from '@/core/i18n'
import {installFailureText, installFile, installStateText, type Installation} from '@/core/install'

let notificationCounter = 0

function progressMessage(installation: Installation): string {
  return `${installStateText(installation.state)} (${installation.progress}%)`
}

export function installDroppedFiles(control: Control, files: File[]): Promise<void> {
  const id = `device-screen-install-${++notificationCounter}`
  const title = translate('App Upload')
  const progress = {id, title, loading: true, autoClose: false as const, withCloseButton: false}

  notifications.show({...progress, message: `${translate('Uploading...')} (0%)`})

  return installFile(control, files, (installation) => {
    if (!installation.settled) {
      notifications.update({...progress, message: progressMessage(installation)})
    }
  }).then((installation) => {
    if (installation.success) {
      notifications.update({
        id
        , title
        , loading: false
        , autoClose: 4000
        , withCloseButton: true
        , color: 'teal'
        , message: `${installation.manifest?.package || 'App'}: ${translate('Installation succeeded.')}`
      })
      return
    }
    notifications.update({
      id
      , title: translate('Oops!')
      , loading: false
      , autoClose: 8000
      , withCloseButton: true
      , color: 'red'
      , message: installFailureText(String(installation.error))
    })
  })
}
