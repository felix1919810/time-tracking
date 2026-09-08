import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import AppIcon from './components/AppIcon.vue'
import './refined.css'
import { initializeTheme } from './lib/theme.js'
import { initializeLanguage } from './i18n.js'

initializeTheme()
initializeLanguage()
createApp(App).component('AppIcon', AppIcon).mount('#app')
