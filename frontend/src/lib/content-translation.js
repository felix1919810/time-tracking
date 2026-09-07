import { ref, readonly, watch } from 'vue'
import { locale, ui } from '../i18n.js'
import { createTranslationClient } from './translation-client.js'

let transport = async () => { throw new Error('Translation is not ready') }
const version = ref(0)
export const showOriginal = ref(false)
watch(showOriginal, () => { version.value++ })
const client = createTranslationClient({
  request: (text, to) => transport(text, to),
  changed: () => { version.value++ },
})
export function configureContentTranslation(request) { transport = request }
export function resetContentTranslations() { client.reset(); showOriginal.value = false }
export function useContentTranslation() {
  return {
    translationVersion: readonly(version),
    tr(text) {
      // Reading this ref causes displayed translations to update when requests finish.
      void version.value
      if (['其他', '未分类', '(无描述)', '-', '—'].includes(text)) return ui(text)
      return client.read(text, locale.value, { translate: !showOriginal.value })
    },
  }
}
