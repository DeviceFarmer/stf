import {describe, expect, it, vi} from 'vitest'
import {
  detectLanguage, gettext, normalizeLanguage, setLanguage, translate, translatePlural
} from './i18n'

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

  it('normalizes browser tags and legacy codes to catalog codes', () => {
    expect(normalizeLanguage('pl-PL')).toBe('pl')
    expect(normalizeLanguage('pt-BR')).toBe('pt_BR')
    expect(normalizeLanguage('pt-PT')).toBe('pt_BR')
    expect(normalizeLanguage('ru-RU')).toBe('ru_RU')
    expect(normalizeLanguage('zh-CN')).toBe('zh_CN')
    expect(normalizeLanguage('zh')).toBe('zh_CN')
    expect(normalizeLanguage('zh-TW')).toBe('zh-Hant')
    expect(normalizeLanguage('zh-Hant-HK')).toBe('zh-Hant')
    expect(normalizeLanguage('xx-YY')).toBeUndefined()
    expect(normalizeLanguage('')).toBeUndefined()
  })

  it('detects the first supported browser language', () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['xx', 'de-AT', 'fr'])
    expect(detectLanguage()).toBe('de')
    languages.mockRestore()
  })

  it('picks plural forms', () => {
    setLanguage('en')
    expect(translatePlural(1, '{{count}} device', '{{count}} devices')).toBe('1 device')
    expect(translatePlural(3, '{{count}} device', '{{count}} devices')).toBe('3 devices')
  })
})
