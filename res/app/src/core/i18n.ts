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

export function setLanguage(language: string): void {
  useLanguage.setState({language: normalizeLanguage(language) || defaultLanguage})
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

export function translatePlural(
  count: number
, singular: string
, plural: string
, params?: TranslateParams
, language?: string
): string {
  const catalog = catalogs[language || useLanguage.getState().language]
  const entry = catalog?.[singular]
  const merged = {count, ...params}
  if (Array.isArray(entry)) {
    const form = entry[count === 1 ? 0 : Math.min(1, entry.length - 1)]
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
