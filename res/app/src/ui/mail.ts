import uniq from 'lodash/uniq'
import {notifications} from '@mantine/notifications'
import {translate} from '@/core/i18n'
import {getSetting} from '@/core/settings'
import {copyToClipboard} from './clipboard'

function openUrl(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

export async function mailTo(emails: string[]): Promise<void> {
  const separator = getSetting<string>('emailAddressSeparator', ',')
  await copyToClipboard(uniq(emails).join(separator))
  notifications.show({message: translate('Paste the email addresses from the clipboard!'), autoClose: 3000})
  openUrl('mailto:?body=*** Paste the email addresses from the clipboard! ***')
}
