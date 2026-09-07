import { readonly, ref } from 'vue'

const currentTheme = ref('dark')
export const theme = readonly(currentTheme)

function applyTheme(value) {
  currentTheme.value = value === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = currentTheme.value
}

export function initializeTheme() {
  let saved = 'dark'
  try { saved = localStorage.getItem('tt_theme') } catch { /* 使用默认主题 */ }
  applyTheme(saved)
}

export function setTheme(value) {
  applyTheme(value)
  try { localStorage.setItem('tt_theme', currentTheme.value) } catch { /* 本次切换仍然生效 */ }
}
