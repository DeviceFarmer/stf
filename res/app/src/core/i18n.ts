import {useMemo} from 'react'
import {create} from 'zustand'
import supportedLanguages from '../../../common/lang/langs.json'
import {catalogs} from './i18n-catalogs'

export const languages = supportedLanguages as Record<string, string>
export const defaultLanguage = 'en'
export const languageSettingKey = 'selectedLanguage'

// Codes users may have saved before the catalogs were renamed
const legacyLanguages: Record<string, string> = {ru_RU: 'ru', ko_KR: 'ko'}

const languagesByKey = new Map(Object.keys(languages).map((code) => [languageKey(code), code]))

function languageKey(code: string): string {
  return code.replace(/_/g, '-').toLowerCase()
}

function chineseLanguage(key: string): string {
  return /^zh-(hant|tw|hk|mo)\b/.test(key) ? 'zh-Hant' : 'zh_CN'
}

// Accepts catalog codes, legacy codes and browser tags like pt-BR or zh-TW
export function normalizeLanguage(code: string | null | undefined): string | undefined {
  if (!code) {
    return undefined
  }
  const key = languageKey(legacyLanguages[code] || code)
  const base = key.split('-')[0]
  if (languagesByKey.has(key)) {
    return languagesByKey.get(key)
  }
  if (base === 'zh') {
    return chineseLanguage(key)
  }
  // Fall back to any regional variant, so pt-PT still gets pt_BR rather than English
  return languagesByKey.get(base) ||
    [...languagesByKey].find(([other]) => other.split('-')[0] === base)?.[1]
}

export function detectLanguage(): string {
  const detected = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []
  for (const code of detected) {
    const language = normalizeLanguage(code)
    if (language) {
      return language
    }
  }
  return defaultLanguage
}

export const useLanguage = create<{language: string}>(() => ({language: detectLanguage()}))

// A missing or unknown code falls back to the browser language
export function setLanguage(language?: string | null): void {
  useLanguage.setState({language: normalizeLanguage(language) || detectLanguage()})
  document.documentElement.lang = useLanguage.getState().language.replace('_', '-')
}

export type TranslateParams = Record<string, string | number | null | undefined>

function interpolate(text: string, params?: TranslateParams): string {
  if (!params) {
    return text
  }
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => {
    const value = params[name]
    return value === undefined || value === null ? '' : String(value)
  })
}

export function translate(msgid: string, params?: TranslateParams, language?: string): string {
  const catalog = catalogs[language || useLanguage.getState().language]
  const entry = catalog?.[msgid]
  const text = Array.isArray(entry) ? entry[0] : entry
  return interpolate(text || msgid, params)
}

// Transifex orders plural forms by CLDR category
const pluralCategoryOrder = ['zero', 'one', 'two', 'few', 'many', 'other']

function pluralIndex(count: number, language: string, forms: number): number {
  try {
    const rules = new Intl.PluralRules(language.replace('_', '-'))
    const categories = [...rules.resolvedOptions().pluralCategories]
      .sort((a, b) => pluralCategoryOrder.indexOf(a) - pluralCategoryOrder.indexOf(b))
    // A browser with other CLDR data may disagree on the forms, so only trust a match
    if (categories.length === forms) {
      return categories.indexOf(rules.select(count))
    }
  }
  catch {
    // Unknown locale, use the fallback below
  }
  // CLDR order puts 'other' last
  return count === 1 ? 0 : forms - 1
}

export function translatePlural(
  count: number
, singular: string
, plural: string
, params?: TranslateParams
, language?: string
): string {
  const current = language || useLanguage.getState().language
  const entry = catalogs[current]?.[singular]
  const merged = {count, ...params}
  if (Array.isArray(entry)) {
    const form = entry[pluralIndex(count, current, entry.length)]
    if (form) {
      return interpolate(form, merged)
    }
  }
  return interpolate(count === 1 ? singular : plural, merged)
}

export function gettext(msgid: string): string {
  return msgid
}

export function useTranslation() {
  const language = useLanguage((state) => state.language)
  return useMemo(() => ({
    language
    , t: (msgid: string, params?: TranslateParams) => translate(msgid, params, language)
  }), [language])
}
