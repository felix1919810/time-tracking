<template>
  <div class="page">
    <!-- 顶部计时器 -->
    <header class="topbar">
      <input class="desc-input" v-model="descInput" placeholder="你在做什么？" />
      <div class="proj-tag">
        <span class="dot" :style="{background: projColor}"></span>
        <span>{{ projName }}</span>
      </div>
      <div class="clock" :class="{running: timerRunning}">{{ clockText }}</div>
      <button class="start-btn" :class="{running: timerRunning}" @click="toggleTimer">
        {{ timerRunning ? '■ 停止' : '▶ 开始' }}
      </button>
    </header>

    <!-- 提示 -->
    <div v-if="errorMsg" class="alert err">{{ errorMsg }}</div>
    <div v-if="okMsg" class="alert ok">{{ okMsg }}</div>

    <!-- 周视图 -->
    <main class="week-main">
      <div class="week-head">
        <div class="nav">
          <button class="nav-btn" @click="shiftWeek(-1)">‹</button>
          <button class="today-btn" @click="goToday">本周</button>
          <button class="nav-btn" @click="shiftWeek(1)">›</button>
          <div class="range-text">{{ rangeText }}</div>
        </div>
        <div class="week-sum">本周总计 <strong :class="{zero: weekTotalMin === 0}">{{ fmtHM(weekTotalMin) }}</strong></div>
      </div>

      <!-- 拉伸条：调整时间轴密度 -->
      <div class="zoom-bar">
        <span class="zoom-label">密度</span>
        <input
          type="range"
          class="zoom-slider"
          :min="HOUR_PX_MIN"
          :max="HOUR_PX_MAX"
          step="16"
          :value="HOUR_PX"
          @input="setHourPx(Number($event.target.value))"
        />
        <span class="zoom-value">{{ HOUR_PX }}px/h</span>
      </div>

      <!-- 日历表 -->
      <div class="cal">
        <!-- 时间列 -->
        <div class="time-col">
          <div class="time-cell" v-for="h in hourList" :key="h" :style="{height: HOUR_PX + 'px'}">
            {{ String(h).padStart(2, '0') }}:00
          </div>
        </div>

        <!-- 7 天列 -->
        <div class="day-col" v-for="d in dayList" :key="d">
          <div class="day-head" :class="{today: isToday(d)}">
            <div class="dow">{{ weekLabels[d - 1] }}</div>
            <div class="dnum">{{ dayNumber(d) }}</div>
            <div class="dtotal" :class="{has: dayTotalMin(d) > 0}">
              {{ dayTotalMin(d) > 0 ? fmtHM(dayTotalMin(d)) : '—' }}
            </div>
          </div>
          <div class="day-body" :style="{height: (24 * HOUR_PX) + 'px'}">
            <!-- 当前时间红线 -->
            <div v-if="isToday(d)" class="now-line" :style="{top: nowOffsetPx + 'px'}"></div>
            <!-- 条目块 -->
            <div
              v-for="e in dayEntries(d)"
              :key="e.record_id"
              class="entry"
              :class="'cat' + catIndex(e)"
              :style="entryStyle(e)"
              @click="openEdit(e)"
            >
              <div class="e-title">{{ e.fields['描述'] || '(无描述)' }}</div>
              <div class="e-time">{{ entryTimeRange(e) }}</div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 编辑/新增面板 -->
    <div v-if="editOpen" class="mask" @click.self="closeEdit">
      <div class="panel">
        <div class="panel-head">
          <span>{{ editingEntry ? '编辑条目' : '新增条目' }}</span>
          <button class="x-btn" @click="closeEdit">×</button>
        </div>
        <div class="row">
          <div class="row-label">描述</div>
          <input class="row-input" v-model="editDesc" placeholder="你在做什么？" />
        </div>
        <div class="row">
          <div class="row-label">任务分类</div>
          <div class="cat-picker">
            <div
              v-for="(c, i) in catList"
              :key="c"
              class="cat-pill"
              :class="{sel: editCat === c}"
              :style="{color: catColors[i], borderColor: editCat === c ? catColors[i] : 'transparent'}"
              @click="editCat = c"
            >
              <span class="dot" :style="{background: catColors[i]}"></span>
              {{ c }}
            </div>
          </div>
        </div>
        <div class="row">
          <div class="row-label">时间</div>
          <div class="time-row">
            <input class="row-input" type="time" v-model="editStart" />
            <span class="time-arrow">→</span>
            <input class="row-input" type="time" v-model="editEnd" />
          </div>
        </div>
        <div class="panel-foot">
          <button v-if="editingEntry" class="del-btn" @click="delEntry">🗑 删除</button>
          <div class="foot-spacer"></div>
          <button class="cancel-btn" @click="closeEdit">取消</button>
          <button class="save-btn" @click="saveEntry">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

// ───── HTTP ─────
// 从当前页面 URL 读 app_token（多人方案：每人一个多维表格）
const urlParams = new URLSearchParams(window.location.search)
const appToken = urlParams.get('app_token') || ''

const http = axios.create({
  baseURL: 'https://1473537498-ejcp1i6ib6.ap-shanghai.tencentscf.com',
  timeout: 15000,
})
// 请求拦截：自动带上 app_token（让 serverless 用对应的多维表格）
http.interceptors.request.use((config) => {
  config.params = config.params || {}
  if (appToken) config.params.app_token = appToken
  return config
})
http.interceptors.response.use(
  (r) => r.data,
  (err) => {
    const msg = err.response?.data?.error || err.response?.data?.detail || err.message
    return Promise.reject(new Error(msg))
  },
)

// ───── 常量 ─────
const HOUR_PX_MIN = 32
const HOUR_PX_MAX = 240
const HOUR_PX_DEFAULT = 192
const weekLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const catList = ['工签', 'Payroll', '入职', '其他']
const catColors = ['#e01b4f', '#3370ff', '#34c759', '#ff9500']
const hourList = Array.from({ length: 24 }, (_, i) => i)  // 0-23
const dayList = [1, 2, 3, 4, 5, 6, 7]

// 拉伸条：用 ref 让 HOUR_PX 可响应式变化
const HOUR_PX = ref(Number(localStorage.getItem('hour_px')) || HOUR_PX_DEFAULT)
function setHourPx(v) {
  HOUR_PX.value = v
  localStorage.setItem('hour_px', String(v))
}

// ───── 状态 ─────
const entries = ref([])
const errorMsg = ref('')
const okMsg = ref('')

// 顶部计时器
const descInput = ref('')
const projName = ref('其他')
const projColor = ref('#ff9500')
const timerRunning = ref(false)
const timerStartMs = ref(0)
const timerElapsedMs = ref(0)
let tickInterval = null

// 周导航
const weekOffset = ref(0)
const today = new Date()
today.setHours(0, 0, 0, 0)

// 编辑面板
const editOpen = ref(false)
const editingEntry = ref(null)
const editDesc = ref('')
const editCat = ref('其他')
const editStart = ref('09:00')
const editEnd = ref('09:30')
const editDay = ref(1)

// ───── 工具 ─────
function getWeekStart(offset = 0) {
  const now = new Date()
  const day = now.getDay() || 7  // 周日=0 → 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function fmtHM(mins) {
  if (mins <= 0) return '0:00'
  const h = Math.floor(mins / 60)
  const m = Math.floor(mins % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function fmtTimeShort(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function extractMs(v) {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'object') return v.value || v.timestamp || null
  return null
}

// 飞书可能返回数字或字符串，统一转成秒数
function durSecOf(e) {
  const v = e.fields['时长(秒)']
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v) || 0
  return 0
}

// ───── 周范围 ─────
const weekStart = computed(() => getWeekStart(weekOffset.value))

const rangeText = computed(() => {
  const s = weekStart.value
  const e = new Date(s)
  e.setDate(s.getDate() + 6)
  return `${s.getMonth() + 1}月${s.getDate()}日 - ${e.getMonth() + 1}月${e.getDate()}日`
})

function dayNumber(d) {
  const date = new Date(weekStart.value)
  date.setDate(date.getDate() + d - 1)
  return date.getDate()
}

function isToday(d) {
  const date = new Date(weekStart.value)
  date.setDate(date.getDate() + d - 1)
  return date.getTime() === today.getTime()
}

function dayEntries(d) {
  const date = new Date(weekStart.value)
  date.setDate(date.getDate() + d - 1)
  const dayStart = date.getTime()
  const dayEnd = dayStart + 86400000
  return entries.value.filter((e) => {
    const ms = extractMs(e.fields['开始时间'])
    return ms != null && ms >= dayStart && ms < dayEnd
  })
}

function dayTotalMin(d) {
  return dayEntries(d).reduce((sum, e) => sum + durSecOf(e), 0) / 60
}

const weekTotalMin = computed(() => {
  let total = 0
  for (let d = 1; d <= 7; d++) total += dayTotalMin(d)
  return total
})

// ───── 条目样式 ─────
function entryStyle(e) {
  const startMs = extractMs(e.fields['开始时间'])
  const durSec = durSecOf(e)
  if (startMs == null) return { display: 'none' }
  const startDate = new Date(startMs)
  const startMin = startDate.getHours() * 60 + startDate.getMinutes()
  const durMin = durSec / 60
  const top = (startMin / 60) * HOUR_PX.value
  const height = Math.max(18, (durMin / 60) * HOUR_PX.value - 2)
  return { top: top + 'px', height: height + 'px' }
}

function entryTimeRange(e) {
  const s = extractMs(e.fields['开始时间'])
  const en = extractMs(e.fields['结束时间'])
  return `${fmtTimeShort(s)} - ${fmtTimeShort(en)}`
}

function catIndex(e) {
  const cat = e.fields['任务分类']
  const idx = catList.indexOf(cat)
  return idx >= 0 ? idx + 1 : 4
}

// ───── 当前时间红线 ─────
const nowOffsetPx = computed(() => {
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return (nowMin / 60) * HOUR_PX.value
})

// ───── 顶部计时器 ─────
const clockText = computed(() => {
  const ms = timerElapsedMs.value
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  return `${h}:${m}:${s}`
})

function toggleTimer() {
  if (!timerRunning.value) {
    timerRunning.value = true
    timerStartMs.value = Date.now()
    timerElapsedMs.value = 0
    tickInterval = setInterval(() => {
      timerElapsedMs.value = Date.now() - timerStartMs.value
    }, 1000)
  } else {
    timerRunning.value = false
    clearInterval(tickInterval)
    stopAndSave()
  }
}

async function stopAndSave() {
  const startMs = timerStartMs.value
  const stopMs = Date.now()
  const durSec = Math.floor((stopMs - startMs) / 1000)
  try {
    await http.post('/entries', {
      fields: {
        '描述': descInput.value || '(未命名)',
        '用户': localStorage.getItem('tt_user') || 'anonymous',
        '开始时间': startMs,
        '结束时间': stopMs,
        '时长(秒)': durSec,
        '状态': 'stopped',
        '任务分类': '其他',
        '是否计费': false,
      },
    })
    okMsg.value = '已保存到多维表格 ✓'
    setTimeout(() => (okMsg.value = ''), 3000)
    await loadEntries()
  } catch (e) {
    errorMsg.value = e.message
    setTimeout(() => (errorMsg.value = ''), 5000)
  }
}

// ───── 加载数据 ─────
async function loadEntries() {
  try {
    const res = await http.get('/entries', { params: { page_size: 100 } })
    entries.value = res.items || []
  } catch (e) {
    errorMsg.value = '加载失败: ' + e.message
    setTimeout(() => (errorMsg.value = ''), 5000)
  }
}

// ───── 编辑/新增/删除 ─────
function openEdit(entry) {
  editingEntry.value = entry
  const f = entry.fields
  editDesc.value = f['描述'] || ''
  editCat.value = catList.includes(f['任务分类']) ? f['任务分类'] : '其他'
  const s = extractMs(f['开始时间'])
  const en = extractMs(f['结束时间'])
  editStart.value = s ? fmtTimeShort(s) : '09:00'
  editEnd.value = en ? fmtTimeShort(en) : '09:30'
  // 找出该 entry 属于周内哪一天
  const entryDate = new Date(s)
  entryDate.setHours(0, 0, 0, 0)
  const ws = weekStart.value
  const diffDays = Math.round((entryDate - ws) / 86400000)
  editDay.value = diffDays >= 0 && diffDays < 7 ? diffDays + 1 : 1
  editOpen.value = true
}

function closeEdit() {
  editOpen.value = false
  editingEntry.value = null
}

async function saveEntry() {
  const [sh, sm] = editStart.value.split(':').map(Number)
  const [eh, em] = editEnd.value.split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  if (endMin <= startMin) {
    errorMsg.value = '结束时间必须晚于开始时间'
    return
  }
  const durSec = (endMin - startMin) * 60
  const date = new Date(weekStart.value)
  date.setDate(date.getDate() + editDay.value - 1)
  date.setHours(sh, sm, 0, 0)
  const startMs = date.getTime()
  const endMs = startMs + durSec * 1000

  try {
    if (editingEntry.value) {
      await http.patch('/entry', {
        id: editingEntry.value.record_id,
        fields: {
          '描述': editDesc.value || '(未命名)',
          '任务分类': editCat.value,
          '开始时间': startMs,
          '结束时间': endMs,
          '时长(秒)': durSec,
        },
      })
      okMsg.value = '条目已更新'
    } else {
      await http.post('/entries', {
        fields: {
          '描述': editDesc.value || '(未命名)',
          '用户': localStorage.getItem('tt_user') || 'anonymous',
          '开始时间': startMs,
          '结束时间': endMs,
          '时长(秒)': durSec,
          '状态': 'stopped',
          '任务分类': editCat.value,
          '是否计费': false,
        },
      })
      okMsg.value = '条目已新增'
    }
    closeEdit()
    await loadEntries()
    setTimeout(() => (okMsg.value = ''), 3000)
  } catch (e) {
    errorMsg.value = e.message
    setTimeout(() => (errorMsg.value = ''), 5000)
  }
}

async function delEntry() {
  if (!editingEntry.value) return
  if (!confirm('确定删除这条记录？')) return
  try {
    await http.delete('/entry', { params: { id: editingEntry.value.record_id } })
    closeEdit()
    await loadEntries()
    okMsg.value = '已删除'
    setTimeout(() => (okMsg.value = ''), 3000)
  } catch (e) {
    errorMsg.value = e.message
  }
}

// ───── 周导航 ─────
function shiftWeek(delta) {
  weekOffset.value += delta
  loadEntries()
}
function goToday() {
  weekOffset.value = 0
  loadEntries()
}

// ───── 生命周期 ─────
onMounted(() => {
  loadEntries()
})
onUnmounted(() => {
  if (tickInterval) clearInterval(tickInterval)
})
</script>

<style scoped>
.page { min-height: 100vh; background: #f5f6fa; }

/* 顶部计时器 */
.topbar {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border-bottom: 1px solid #e7e9e8;
  padding: 10px 24px; position: sticky; top: 0; z-index: 50;
}
.desc-input {
  flex: 1; max-width: 400px; padding: 8px 12px;
  border: 1px solid #e7e9e8; border-radius: 6px;
  font-size: 13px; background: #fafbfc; color: #1f2329;
}
.desc-input:focus { outline: none; border-color: #3370ff; background: #fff; }
.proj-tag {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border: 1px solid #e7e9e8; border-radius: 6px;
  font-size: 12px; color: #646a73; background: #fafbfc;
  min-width: 100px;
}
.dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.clock {
  font-variant-numeric: tabular-nums; font-weight: 600;
  color: #1f2329; font-size: 14px; min-width: 70px; text-align: right;
}
.clock.running { color: #e01b4f; }
.start-btn {
  padding: 8px 16px; border: none; border-radius: 6px;
  background: #1f2329; color: #fff; font-size: 13px; font-weight: 600;
}
.start-btn:hover { background: #000; }
.start-btn.running { background: #e01b4f; }
.start-btn.running:hover { background: #c4153f; }

/* 提示 */
.alert { padding: 10px 24px; font-size: 13px; }
.alert.err { background: #fee2e2; color: #991b1b; }
.alert.ok { background: #d1fae5; color: #065f46; }

/* 周视图 */
.week-main { padding: 16px 24px 24px; }
.week-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}

/* 拉伸条 */
.zoom-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; margin-bottom: 12px;
  background: #fff; border: 1px solid #e7e9e8; border-radius: 6px;
}
.zoom-label { font-size: 12px; color: #646a73; }
.zoom-slider {
  flex: 1; max-width: 300px; height: 4px;
  -webkit-appearance: none; appearance: none;
  background: #e7e9e8; border-radius: 2px; outline: none;
}
.zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: #3370ff; cursor: pointer; border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.zoom-slider::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: #3370ff; cursor: pointer; border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.zoom-value { font-size: 12px; color: #646a73; min-width: 60px; }

.nav { display: flex; align-items: center; gap: 6px; }
.nav-btn {
  width: 28px; height: 28px; border: 1px solid #e7e9e8; background: #fff;
  border-radius: 4px; font-size: 14px; color: #646a73;
}
.nav-btn:hover { background: #f5f6f7; }
.today-btn {
  padding: 5px 12px; font-size: 12px; border: 1px solid #e7e9e8;
  background: #fff; border-radius: 4px; color: #646a73;
}
.today-btn:hover { background: #f5f6f7; }
.range-text { font-size: 16px; font-weight: 700; color: #1f2329; margin-left: 8px; }
.week-sum { font-size: 13px; color: #646a73; }
.week-sum strong { color: #e01b4f; font-weight: 700; font-size: 15px; margin-left: 4px; }
.week-sum strong.zero { color: #8f959e; }

/* 日历表 */
.cal {
  display: grid; grid-template-columns: 50px repeat(7, 1fr);
  border: 1px solid #e7e9e8; border-radius: 6px; overflow: hidden;
  background: #fff;
}
.time-col { border-right: 1px solid #f0f1f2; background: #fafbfc; }
.time-cell {
  padding: 2px 6px 0 0;
  font-size: 10px; color: #8f959e; text-align: right;
}
.day-col { display: flex; flex-direction: column; border-left: 1px solid #f0f1f2; }
.day-head {
  padding: 8px 4px; text-align: center; border-bottom: 1px solid #e7e9e8;
  background: #fafbfc;
}
.day-head.today { background: #fef0f4; }
.dow { font-size: 11px; color: #8f959e; margin-bottom: 2px; }
.dnum { font-size: 18px; font-weight: 700; color: #1f2329; }
.day-head.today .dnum { color: #e01b4f; }
.dtotal { font-size: 10px; color: #8f959e; margin-top: 2px; }
.dtotal.has { color: #646a73; font-weight: 600; }

.day-body { position: relative; }
.entry {
  position: absolute; left: 2px; right: 2px;
  border-radius: 3px; padding: 3px 5px; color: #fff;
  font-size: 10px; cursor: pointer; overflow: hidden;
  border-left: 3px solid rgba(0, 0, 0, 0.2);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.entry:hover { z-index: 20; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
.e-title { font-weight: 600; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.e-time { font-size: 9px; opacity: 0.9; margin-top: 1px; }

.now-line {
  position: absolute; left: 0; right: 0; height: 2px;
  background: #e01b4f; z-index: 15; pointer-events: none;
}
.now-line::before {
  content: ''; position: absolute; left: -4px; top: -3px;
  width: 8px; height: 8px; background: #e01b4f; border-radius: 50%;
}

/* 分类颜色 */
.cat1 { background: #e01b4f; } /* 工签 */
.cat2 { background: #3370ff; } /* Payroll */
.cat3 { background: #34c759; } /* 入职 */
.cat4 { background: #ff9500; } /* 其他 */

/* 编辑面板 */
.mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4);
  z-index: 100; display: flex; align-items: center; justify-content: center;
}
.panel {
  background: #fff; border-radius: 8px; padding: 20px;
  width: 420px; max-width: 90vw; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}
.panel-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 16px; font-weight: 700; margin-bottom: 16px;
}
.x-btn { font-size: 20px; color: #8f959e; background: none; border: none; padding: 4px 8px; }
.x-btn:hover { color: #1f2329; }
.row { margin-bottom: 12px; }
.row-label { font-size: 12px; color: #646a73; margin-bottom: 6px; }
.row-input {
  width: 100%; padding: 8px 12px; border: 1px solid #e7e9e8;
  border-radius: 6px; font-size: 13px; color: #1f2329; background: #fff;
}
.row-input:focus { outline: none; border-color: #3370ff; }
.cat-picker { display: flex; gap: 6px; flex-wrap: wrap; }
.cat-pill {
  padding: 5px 10px; border-radius: 14px; font-size: 12px; cursor: pointer;
  border: 2px solid transparent; display: flex; align-items: center; gap: 6px;
  background: #fafbfc;
}
.cat-pill:hover { background: #f0f1f2; }
.cat-pill.sel { background: #f0f5ff; }
.time-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; }
.time-arrow { color: #8f959e; font-size: 12px; }
.panel-foot { display: flex; align-items: center; margin-top: 20px; }
.foot-spacer { flex: 1; }
.del-btn { background: none; border: none; color: #ff453a; font-size: 13px; padding: 8px 12px; border-radius: 4px; }
.del-btn:hover { background: #fee2e2; }
.cancel-btn { padding: 8px 16px; background: #f5f6f7; color: #646a73; border: none; border-radius: 6px; font-size: 13px; }
.cancel-btn:hover { background: #e7e9e8; }
.save-btn { padding: 8px 16px; background: #3370ff; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; margin-left: 8px; }
.save-btn:hover { background: #2860e8; }
</style>
