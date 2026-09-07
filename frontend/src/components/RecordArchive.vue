<template>
 <div class="modal-mask archive-mask" @click.self="$emit('close')">
  <section class="modal-card archive-card" role="dialog" aria-modal="true" :aria-label="ui(recordId ? '修改历史' : '最近删除')">
   <header class="modal-header"><div><div class="archive-eyebrow">TIME TRACKING / RECORDS</div><h2 class="modal-title">{{ ui(recordId ? '修改历史' : '最近删除') }}</h2></div><button class="modal-close" @click="$emit('close')" :aria-label="ui('关闭')">×</button></header>
   <div class="modal-body archive-body">
    <p class="archive-hint">{{ ui(recordId ? '仅记录功能上线后的修改，不支持一键回退。' : '删除的记录不计入报表，可在删除后 30 天内恢复。') }}</p>
    <p v-if="error" class="archive-error" role="alert">{{ error }} <button class="btn btn-secondary" @click="load">{{ ui('重试') }}</button></p>
    <p v-if="loading" class="archive-empty">{{ ui('加载中...') }}</p>
    <p v-else-if="!items.length && !error" class="archive-empty">{{ ui(recordId ? '暂无修改历史' : '暂无可恢复的记录') }}</p>
    <template v-else-if="recordId">
     <article v-for="item in items" :key="item.record_id" class="history-item">
      <div class="history-meta"><span class="history-badge">{{ ui(actions[item.action] || item.action) }}</span><strong>{{ item.actor }}</strong><time>{{ date(item.occurred_at) }}</time></div>
      <p v-if="item.status !== 'committed'" class="archive-error">{{ ui('结果待确认，请核对当前记录；以下为本次操作意图。') }}</p>
      <div v-for="change in changes(item)" :key="change.key" class="history-change"><div class="change-label">{{ ui(change.label) }}</div><div class="change-values"><span class="old-value">{{ value(change.key, change.before) }}</span><span aria-hidden="true">→</span><span>{{ value(change.key, change.after) }}</span></div></div>
     </article>
    </template>
    <template v-else>
     <article v-for="item in items" :key="item.record_id" class="trash-item">
      <div><strong>{{ tr(item.fields.description || '无描述') }}</strong><p class="archive-hint">{{ item.fields.user }} · {{ tr(item.fields.category || '其他') }} · {{ date(item.fields.start_time) }}</p><small>{{ ui('删除于') }} {{ date(item.fields.deleted_at) }} · {{ ui('剩余 {0} 天', [remaining(item)]) }}</small></div>
      <div class="trash-actions"><button class="btn btn-secondary" @click="$emit('history', item.record_id)">{{ ui('修改历史') }}</button><button class="btn btn-primary" :disabled="!!restoring" @click="restore(item)">{{ restoring === item.record_id ? ui('恢复中...') : ui('恢复') }}</button></div>
     </article>
    </template>
   </div>
  </section>
 </div>
</template>
<script setup>
import {ref,inject,onMounted,watch} from 'vue'
import {ui,localDate,countryName} from '../i18n.js'
import {useContentTranslation} from '../lib/content-translation.js'
const {tr}=useContentTranslation()
const props=defineProps({recordId:{type:String,default:''}}),emit=defineEmits(['close','history'])
const http=inject('http'),store=inject('entryStore'),user=inject('userName'),account=user.value
const items=ref([]),loading=ref(false),error=ref(''),restoring=ref('');let revision=0
const actions={edit:'修改',delete:'删除',restore:'恢复'}
const labels={description:'任务名称',category:'任务分类',country:'国家',notes:'备注',start_time:'开始时间',end_time:'结束时间',deleted_at:'删除状态'}
function changes(item){return Object.entries(labels).filter(([key])=>JSON.stringify(item.before[key]??null)!==JSON.stringify(item.after[key]??null)).map(([key,label])=>({key,label,before:item.before[key],after:item.after[key]}))}
function date(v){return localDate(v,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
function value(key,v){if(key==='deleted_at')return ui(v?'已删除':'正常');if(!v)return '—';if(key.endsWith('_time'))return date(v);if(key==='country')return countryName(v);return String(v)}
function remaining(item){return Math.max(0,Math.ceil((Number(item.fields.deleted_at)+30*86400000-Date.now())/86400000))}
async function load(){const version=++revision;loading.value=true;error.value='';items.value=[];try{const d=await http(props.recordId?'/entries/'+encodeURIComponent(props.recordId)+'/history':'/entries/deleted');if(version===revision)items.value=d.items||[]}catch(e){if(version===revision)error.value=e.message}finally{if(version===revision)loading.value=false}}
async function restore(item){if(restoring.value)return;restoring.value=item.record_id;error.value='';try{const d=await http('/entries/'+encodeURIComponent(item.record_id)+'/restore',{method:'POST'});if(user.value!==account)return;store.update(d.record);items.value=items.value.filter(e=>e.record_id!==item.record_id)}catch(e){error.value=e.message}finally{restoring.value=''}}
onMounted(load);watch(()=>props.recordId,load)
</script>
<style scoped>
.archive-card { width:min(800px,94vw); max-height:88vh; display:flex; flex-direction:column; }.archive-body { overflow:auto; }.archive-eyebrow { font-size:10px; letter-spacing:2px; color:var(--text-secondary); margin-bottom:8px; }.archive-hint { color:var(--text-secondary); font-size:13px; line-height:1.6; margin:8px 0 16px; }.archive-empty { text-align:center; padding:48px 12px; color:var(--text-secondary); }.archive-error { color:var(--danger); font-size:13px; margin-bottom:14px; }
.history-item,.trash-item { border:1px solid var(--border); border-radius:10px; padding:18px; margin-bottom:14px; }.history-meta { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-bottom:16px; }.history-meta time { margin-left:auto; font-size:12px; color:var(--text-secondary); }.history-badge { padding:4px 8px; border-radius:5px; background:var(--surface-light); color:var(--primary); font-size:12px; }.history-change { padding:10px 0; border-top:1px solid var(--border); }.change-label { font-size:12px; color:var(--text-secondary); margin-bottom:6px; }.change-values { display:grid; grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr); gap:12px; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; }.old-value { color:var(--text-secondary); }.trash-item { display:flex; align-items:center; justify-content:space-between; gap:16px; }.trash-item small { color:var(--text-secondary); }.trash-actions { display:flex; gap:8px; flex-shrink:0; }@media(max-width:650px){.trash-item { align-items:stretch; flex-direction:column; }.trash-actions { justify-content:flex-end; }}
</style>
