import {describe, expect, it} from 'vitest'
import {gettext, setLanguage, translate, translatePlural} from './i18n'

describe('i18n', () => {
  it('falls back to the msgid and interpolates parameters', () => {
    setLanguage('en')
    expect(translate('Devices')).toBe('Devices')
    expect(translate('Hello {{name}}', {name: 'STF'})).toBe('Hello STF')
    expect(gettext('Devices')).toBe('Devices')
  })

  it('translates with the selected catalog', () => {
    setLanguage('fr')
    expect(translate('Devices')).toBe('Appareils')
    expect(translate('Hello {{ name }}', {name: 'STF'})).toBe('Hello STF')
    expect(translate('Hello {{name}}', {name: 'STF'})).toBe('Bonjour STF')
    setLanguage('xx')
    expect(translate('Devices')).toBe('Devices')
  })

  it('picks plural forms', () => {
    setLanguage('en')
    expect(translatePlural(1, '{{count}} device', '{{count}} devices')).toBe('1 device')
    expect(translatePlural(3, '{{count}} device', '{{count}} devices')).toBe('3 devices')
  })
})
