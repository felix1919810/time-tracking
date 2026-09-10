import { readonly, ref } from 'vue'

const currentTheme = ref('dark')
export const theme = readonly(currentTheme)
let timer
let initialized = false

function normalizeTheme(value) {
  return ['light', 'dark', 'auto'].includes(value) ? value : 'dark'
}

function refreshTheme() {
  clearTimeout(timer)
  const now = new Date()
  const daytime = now.getHours() >= 7 && now.getHours() < 19
  document.documentElement.dataset.theme = currentTheme.value === 'auto'
    ? (daytime ? 'light' : 'dark') : currentTheme.value
  if (currentTheme.value === 'auto') {
    const next = new Date(now)
    next.setHours(now.getHours() < 7 ? 7 : now.getHours() < 19 ? 19 : 31, 0, 0, 0)
    // Check clock/time-zone changes too, and recalculate after a sleeping tab resumes.
    timer = setTimeout(refreshTheme, Math.min(next - now, 60000))
  }
}

function applyTheme(value) {
  currentTheme.value = normalizeTheme(value)
  refreshTheme()
}

export function initializeTheme() {
  let saved = 'dark'
  try { saved = localStorage.getItem('tt_theme') } catch { /* 使用默认主题 */ }
  applyTheme(saved)
  if (!initialized) {
    initialized = true
    window.addEventListener('focus', refreshTheme)
    document.addEventListener('visibilitychange', refreshTheme)
    window.addEventListener('storage', event => {
      if (event.key === 'tt_theme' || event.key === null) initializeTheme()
    })
  }
}

export function setTheme(value) {
  applyTheme(value)
  try { localStorage.setItem('tt_theme', currentTheme.value) } catch { /* 本次切换仍然生效 */ }
}
