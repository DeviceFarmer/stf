import type {Catalog} from '@/core/i18n-catalogs'

export const catalogs: Record<string, Catalog> = {
  fr: {
    Devices: 'Appareils'
    , 'Hello {{name}}': 'Bonjour {{name}}'
  }
  , pl: {
    '{{count}} device': ['{{count}} urządzenie', '{{count}} urządzenia', '{{count}} urządzeń', '{{count}} urządzenia']
  }
}
