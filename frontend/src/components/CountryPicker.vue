<template>
  <div class="country-picker">
    <input :value="open ? query : countryName(modelValue)" :placeholder="ui('检索国家...')" :aria-label="ui('国家')" :aria-expanded="open" role="combobox" aria-autocomplete="list" @input="query = $event.target.value; open = true" @focus="query = ''; open = true" @blur="close" @keydown.escape="open = false" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="choose(matches[index])" />
    <div v-if="open" class="country-options" role="listbox" :aria-label="ui('国家')">
      <button v-for="(country, i) in matches" :key="country.code || country.name" type="button" role="option" :aria-selected="modelValue === country.name" :class="{ active: i === index }" @mousedown.prevent="choose(country)">
        <span>{{ countryName(country) }}</span><small>{{ country.code }}</small>
      </button>
      <div v-if="!matches.length" class="country-empty">{{ ui('无匹配国家') }}</div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
import { ui, countryName, countryMatches } from '../i18n.js'
const props = defineProps({ modelValue: { type: String, default: '' }, countries: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const open = ref(false), query = ref(''), index = ref(0)
const matches = computed(() => props.countries.filter(c => countryMatches(c, query.value)).slice(0, 50))
watch(query, () => { index.value = 0 })
function move(step) { open.value = true; index.value = Math.max(0, Math.min(matches.value.length - 1, index.value + step)) }
function choose(country) { if (country) emit('update:modelValue', country.name); open.value = false }
function close() { open.value = false }
</script>
<style scoped>
.country-picker { position: relative; }
input { width: 100%; padding: 9px 12px; border: 1px solid var(--border-light); border-radius: var(--radius); background: var(--bg); color: var(--text); font: inherit; }
.country-options { position: absolute; inset: 100% 0 auto; z-index: 30; max-height: 240px; overflow-y: auto; background: var(--surface); border: 1px solid var(--border-light); box-shadow: var(--shadow-lg); border-radius: var(--radius); }
button { display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 8px 12px; background: transparent; color: var(--text); border: 0; text-align: left; }
button.active, button:hover { background: var(--surface-hover); }
small, .country-empty { color: var(--text-secondary); }
.country-empty { padding: 12px; }
</style>
