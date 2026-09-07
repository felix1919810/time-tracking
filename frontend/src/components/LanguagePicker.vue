<template>
  <label class="language-picker">
    <span>{{ ui('语言') }}</span>
    <select :value="locale" :aria-label="ui('语言')" @change="setLang($event.target.value)">
      <option value="zh">简体中文</option>
      <option value="en">English</option>
    </select>
  </label>
</template>
<script setup>
import { locale, setLang, ui } from '../i18n.js'
</script>
<style scoped>
.language-picker { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; }
select { min-width: 100px; padding: 6px 8px; border: 1px solid var(--border-light); border-radius: var(--radius); background: var(--surface); color: var(--text); }
</style>
