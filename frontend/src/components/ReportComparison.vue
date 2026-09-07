<template>
  <section class="comparison">
    <div class="comparison-heading"><h3>{{ ui('对比分析') }}</h3><label>{{ ui('比较类型') }} <select v-model="kind" :aria-label="ui('比较类型')"><option v-for="type in types" :key="type.key" :value="type.key">{{ ui(type.label) }}</option></select></label></div>
    <p class="hint">{{ ui('比较仅使用当前查看范围内的数据；按任务开始日期归属，日均按活跃天数计算。') }}</p>
    <p class="hint" v-if="kind !== 'period'">{{ ui('比较时保留其他筛选条件，忽略所比较维度的筛选。') }}</p>
    <div class="comparison-sides">
      <div v-for="(side, index) in sides" :key="index" class="comparison-side">
        <label class="side-title">{{ index === 0 ? 'A' : 'B' }}
          <select v-if="kind !== 'period'" v-model="side.value" :aria-label="ui('比较对象') + ' ' + (index === 0 ? 'A' : 'B')">
            <option value="">{{ ui('请选择') }}</option>
            <option v-for="value in options" :key="value" :value="value">{{ label(value) }}</option>
          </select>
        </label>
        <div v-if="kind === 'period'" class="date-inputs"><label>{{ ui('开始日期') }}<input type="date" v-model="side.start" :aria-label="ui('开始日期') + ' ' + index" /></label><label>{{ ui('结束日期') }}<input type="date" v-model="side.end" :aria-label="ui('结束日期') + ' ' + index" /></label></div>
        <template v-if="valid">
          <div class="hours">{{ hours(metrics[index].minutes) }}</div>
          <div class="bar-track"><div :class="['bar', {second:index === 1}]" :style="{width: barWidth(metrics[index].minutes) + '%'}"></div></div>
          <dl><div><dt>{{ ui('任务条目数') }}</dt><dd>{{ metrics[index].count }}</dd></div><div><dt>{{ ui('活跃天数') }}</dt><dd>{{ metrics[index].days }}</dd></div><div><dt>{{ ui('日均工时') }}</dt><dd>{{ hours(metrics[index].average) }}</dd></div></dl>
          <p v-if="!metrics[index].count" class="hint">{{ ui('暂无数据') }}</p>
        </template>
      </div>
    </div>
    <p v-if="!valid" class="hint">{{ ui('请选择两个不同对象，或填写两个有效且不同的时间段。') }}</p>
    <p v-else class="difference">{{ ui('工时差值（A − B）') }}: {{ difference >= 0 ? '+' : '−' }}{{ hours(Math.abs(difference)) }} · {{ ui('相对 B') }}: {{ percentage }}</p>
  </section>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
import { ui, countryName } from '../i18n.js'
import { useContentTranslation } from '../lib/content-translation.js'
import { filterReportEntries, reportMetrics } from '../lib/report-analysis.js'
const { tr } = useContentTranslation()
const props = defineProps({entries:Array, filters:Object, start:Date, end:Date, now:Number})
const types = [{key:'category',label:'任务分类'},{key:'user',label:'成员'},{key:'country',label:'国家'},{key:'period',label:'时间段'}]
const kind = ref('category')
const sides = ref([{value:'',start:'',end:''},{value:'',start:'',end:''}])
const options = computed(() => [...new Set(props.entries.map(e => e.fields[kind.value]).filter(Boolean))].sort())
watch(kind, () => { for (const side of sides.value) side.value = '' })
watch(options, values => { for (const side of sides.value) if (!values.includes(side.value)) side.value = '' })
const valid = computed(() => kind.value === 'period'
  ? sides.value.every(s => s.start && s.end && s.start <= s.end) && (sides.value[0].start !== sides.value[1].start || sides.value[0].end !== sides.value[1].end)
  : sides.value.every(s => s.value && options.value.includes(s.value)) && sides.value[0].value !== sides.value[1].value && props.start && props.end && props.start <= props.end)
const metrics = computed(() => sides.value.map(side => {
  const filters = {...props.filters}
  if (kind.value !== 'period') filters[kind.value] = side.value
  const start = kind.value === 'period' ? new Date(side.start + 'T00:00:00') : props.start
  const end = kind.value === 'period' ? new Date(side.end + 'T23:59:59.999') : props.end
  return reportMetrics(filterReportEntries(props.entries, filters, start, end), props.now)
}))
const difference = computed(() => metrics.value[0].minutes - metrics.value[1].minutes)
const percentage = computed(() => metrics.value[1].minutes ? (difference.value >= 0 ? '+' : '') + (difference.value / metrics.value[1].minutes * 100).toFixed(1) + '%' : ui('B 为零，无法计算百分比'))
function label(value) { return kind.value === 'country' ? countryName(value) : kind.value === 'category' ? tr(value) : value }
function hours(minutes) { const m = Math.round(minutes); return Math.floor(m / 60) + 'h ' + m % 60 + 'm' }
function barWidth(minutes) { const max = Math.max(...metrics.value.map(m => m.minutes)); return max ? minutes / max * 100 : 0 }
</script>
<style scoped>
.comparison { margin:20px 0; padding:20px; border:1px solid var(--border); background:var(--surface); border-radius:12px; }
.comparison-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; } h3 { margin:0; font-size:16px; }
.hint { font-size:12px; color:var(--text-secondary); line-height:1.6; }
.comparison-sides { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; margin-top:16px; }
.comparison-side { padding:16px; background:var(--bg); border-radius:8px; min-width:0; }.side-title { display:flex; align-items:center; gap:12px; font-weight:600; }
select,input { min-width:0; max-width:100%; box-sizing:border-box; padding:8px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); }.side-title select { flex:1; }
.date-inputs { display:flex; flex-wrap:wrap; gap:12px; margin-top:10px; }.date-inputs label { display:grid; gap:6px; font-size:12px; }
.hours { font-size:28px; font-weight:600; margin:18px 0 10px; }.bar-track { height:8px; background:var(--border); border-radius:4px; overflow:hidden; }.bar { height:100%; background:#6366f1; }.bar.second { background:#10b981; }
dl { display:flex; flex-wrap:wrap; gap:20px; }dt { font-size:12px; color:var(--text-secondary); }dd { margin:6px 0 0; font-size:16px; }.difference { font-size:14px; margin-bottom:0; }
@media(max-width:650px) { .comparison-sides { grid-template-columns:1fr; } }
</style>

