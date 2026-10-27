import {translate} from '@/core/i18n'
import {openConfirm} from './modals'

export function confirmReleaseReservation(): Promise<boolean> {
  return openConfirm({
    title: translate('Release reservation')
    , message: translate('Release this STF reservation? The external automation session must be stopped separately.')
    , confirmLabel: translate('Release reservation')
    , danger: true
  })
}
