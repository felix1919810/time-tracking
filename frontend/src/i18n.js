import { ref, readonly } from 'vue'
import zh from './locales/zh.json'
import en from './locales/en.json'
import countryLabels from './locales/countries.json'

const currentLocale = ref('zh')
export const locale = readonly(currentLocale)
export function setLang(value) {
  currentLocale.value = value === 'en' ? 'en' : 'zh'
  if (typeof document !== 'undefined') document.documentElement.lang = currentLocale.value === 'en' ? 'en' : 'zh-CN'
  try { localStorage.setItem('tt_lang', currentLocale.value) } catch { /* Use in-memory preference. */ }
}
export function initializeLanguage() {
  let saved = 'zh'
  try { saved = localStorage.getItem('tt_lang') } catch { /* Default to Chinese. */ }
  setLang(saved)
}
export function ui(key, params = {}) {
  const text = (currentLocale.value === 'en' ? en : zh)[key] ?? key
  return String(text).replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match)
}
export const t = ui
export const getLang = () => currentLocale.value

const countryCodes = new Map(Object.entries(countryLabels).flatMap(([code, names]) =>
  [code, names.zh, names.en].map(name => [name.toLowerCase(), code])))
for (const [name, code] of Object.entries({国内:'CN',台湾:'TW',中国台湾:'TW',香港:'HK',中国香港:'HK',澳门:'MO',中国澳门:'MO'})) countryCodes.set(name, code)
export function countryName(value) {
  const name = typeof value === 'object' ? value?.name || '' : value || ''
  const code = typeof value === 'object' ? value?.code : countryCodes.get(String(name).toLowerCase())
  return countryLabels[code]?.[currentLocale.value] || ui(name)
}
export function countryMatches(country, query) {
  const q = query.trim().toLowerCase()
  const names = countryLabels[country.code] || {}
  return [country.name, country.code, names.zh, names.en].some(value => String(value || '').toLowerCase().includes(q))
}
export function originalCountryName(value) {
  const code = countryCodes.get(String(value || '').toLowerCase())
  return countryLabels[code]?.zh || value
}
export function localDate(value, options = {}) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat(currentLocale.value === 'en' ? 'en-GB' : 'zh-CN', options).format(date)
}
