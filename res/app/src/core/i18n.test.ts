import {describe, expect, it, vi} from 'vitest'
import {
  detectLanguage, gettext, normalizeLanguage, setLanguage, translate, translatePlural, useLanguage
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
    setLanguage('en')
    expect(translate('Devices')).toBe('Devices')
  })

  it('falls back to the browser language for a missing or unknown code', () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR'])
    setLanguage('xx')
    expect(useLanguage.getState().language).toBe('fr')
    setLanguage(undefined)
    expect(useLanguage.getState().language).toBe('fr')
    languages.mockRestore()
    setLanguage('en')
  })

  it('normalizes browser tags and legacy codes to catalog codes', () => {
    expect(normalizeLanguage('pl-PL')).toBe('pl')
    expect(normalizeLanguage('pt-BR')).toBe('pt_BR')
    expect(normalizeLanguage('pt-PT')).toBe('pt_BR')
    expect(normalizeLanguage('ru-RU')).toBe('ru')
    expect(normalizeLanguage('ru_RU')).toBe('ru')
    expect(normalizeLanguage('ko_KR')).toBe('ko')
    expect(normalizeLanguage('zh-CN')).toBe('zh_CN')
    expect(normalizeLanguage('zh')).toBe('zh_CN')
    expect(normalizeLanguage('zh-TW')).toBe('zh-Hant')
    expect(normalizeLanguage('zh-Hant-HK')).toBe('zh-Hant')
    expect(normalizeLanguage('xx-YY')).toBeUndefined()
    expect(normalizeLanguage('')).toBeUndefined()
  })

  it('keeps users on their saved legacy language', () => {
    setLanguage('ru_RU')
    expect(useLanguage.getState().language).toBe('ru')
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

  it('picks plural forms by CLDR category', () => {
    const devices = (count: number) => translatePlural(count, '{{count}} device', '{{count}} devices', {}, 'pl')
    expect(devices(1)).toBe('1 urządzenie')
    expect(devices(3)).toBe('3 urządzenia')
    expect(devices(5)).toBe('5 urządzeń')
    expect(devices(22)).toBe('22 urządzenia')
    expect(devices(1.5)).toBe('1.5 urządzenia')
  })
})
