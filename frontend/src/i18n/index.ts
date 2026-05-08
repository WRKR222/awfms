/**
 * PW-03 — i18next configuration
 *
 * Language detection order:
 * 1. localStorage (persisted user choice from Settings)
 * 2. Browser language
 * 3. Fallback: English
 *
 * Supported languages: en (English), sw (Kiswahili)
 * Priority screens: all Attendant-facing entry and checklist pages
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import sw from './locales/sw.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English',    nativeLabel: 'English' },
  { code: 'sw', label: 'Swahili',    nativeLabel: 'Kiswahili' },
] as const;

export type LangCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const STORAGE_KEY = 'awfms-language';

function detectLanguage(): LangCode {
  const stored = localStorage.getItem(STORAGE_KEY) as LangCode | null;
  if (stored && SUPPORTED_LANGUAGES.some(l => l.code === stored)) return stored;
  const browser = navigator.language?.split('-')[0] as LangCode;
  if (SUPPORTED_LANGUAGES.some(l => l.code === browser)) return browser;
  return 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, sw: { translation: sw } },
    lng: detectLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    // Plural rules use 'count' key — simple one/other for now
    pluralSeparator: '_',
  });

export function setLanguage(code: LangCode) {
  i18n.changeLanguage(code);
  localStorage.setItem(STORAGE_KEY, code);
}

export function getCurrentLanguage(): LangCode {
  return (i18n.language as LangCode) ?? 'en';
}

export default i18n;
