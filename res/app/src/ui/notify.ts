import {notifications} from '@mantine/notifications'
import {translate} from '@/core/i18n'
import {errorMessage} from './modals'

export function notifyFailure(error: unknown, title?: string) {
  notifications.show({
    color: 'red'
    , title: title ?? translate('Oops!')
    , message: errorMessage(error)
  })
}
