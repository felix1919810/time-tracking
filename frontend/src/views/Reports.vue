<template>
  <div class="reports">
    <!-- 页头 -->
    <div class="reports-header">
      <div class="reports-title-wrap">
        <div class="page-title">报表</div>
        <div class="page-subtitle">{{ displayName }} · {{ roleLabel }}</div>
      </div>
      <!-- 查看对象 (团队管理员/管理员可见) -->
      <div v-if="canViewOthers" class="view-switch">
        <label>查看:</label>
        <select v-model="viewScope" @change="onScopeChange">
          <option v-if="userRole !== 'admin'" value="self">自己 ({{ displayName }})</option>
          <option v-if="userRole === 'team_admin'" value="team">本团队总表</option>
          <option v-if="userRole === 'admin'" value="all">全部总表</option>
          <option value="member">指定成员个人表</option>
        </select>
        <div v-if="viewScope === 'member'" class="member-search-wrap">
          <input
            v-model="memberSearch"
            class="member-search-input"
            placeholder="检索成员..."
            @focus="showMemberDropdown = true"
            @blur="hideMemberDropdownLater"
          />
          <div v-if="showMemberDropdown" class="member-dropdown">
            <div class="member-option" :class="{ active: selectedUser === '' }" @mousedown="pickMember('')">
              (全部成员)
            </div>
            <div
              v-for="u in filteredMembers"
              :key="u.user"
              class="member-option"
              :class="{ active: selectedUser === u.user }"
              @mousedown="pickMember(u.user)"
            >
              {{ u.user }}
              <span v-if="u.displayName && u.displayName !== u.user" class="member-sub">{{ u.displayName }}</span>
            </div>
            <div v-if="filteredMembers.length === 0" class="member-empty">无匹配成员</div>
          </div>
        </div>
        <select v-if="viewScope === 'all' && userRole === 'admin'" v-model="selectedTeam" @change="loadData">
          <option value="">(全部团队)</option>
          <option v-for="t in allTeams" :key="t.name" :value="t.name">{{ t.name }}</option>
        </select>
      </div>
    </div>

    <!-- ════════ 时间区间选择 ════════ -->
    <div class="period-bar">
      <div class="period-tabs">
        <button :class="{ active: periodType === 'day' }" @click="setPeriodType('day')">日</button>
        <button :class="{ active: periodType === 'week' }" @click="setPeriodType('week')">周</button>
        <button :class="{ active: periodType === 'month' }" @click="setPeriodType('month')">月</button>
        <button :class="{ active: periodType === 'custom' }" @click="setPeriodType('custom')">自定义</button>
      </div>
      <div class="period-nav">
        <button class="nav-arrow" @click="periodOffset--" :disabled="periodType === 'custom'">‹</button>
        <span class="period-label">{{ periodLabel }}</span>
        <button class="nav-arrow" @click="periodOffset++" :disabled="periodType === 'custom'">›</button>
        <button class="today-btn" @click="goCurrent" :disabled="periodType === 'custom'">今天</button>
      </div>
      <!-- 自定义区间 -->
      <div v-if="periodType === 'custom'" class="custom-range">
        <input type="date" v-model="customStart" @change="onCustomChange" />
        <span>~</span>
        <input type="date" v-model="customEnd" @change="onCustomChange" />
      </div>
    </div>

    <!-- ════════ 汇总卡片 ════════ -->
    <div class="summary-cards">
      <div class="summary-card">
        <div class="summary-icon">⏱</div>
        <div class="summary-body">
          <div class="summary-label">区间总工时</div>
          <div class="summary-value">{{ fmtHM(rangeTotalMin) }}</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon">📋</div>
        <div class="summary-body">
          <div class="summary-label">任务条目数</div>
          <div class="summary-value">{{ rangeEntries.length }}</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon">📊</div>
        <div class="summary-body">
          <div class="summary-label">日均工时</div>
          <div class="summary-value">{{ fmtHM(avgDailyMin) }}</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon">📅</div>
        <div class="summary-body">
          <div class="summary-label">活跃天数</div>
          <div class="summary-value">{{ activeDays }}</div>
        </div>
      </div>
    </div>

    <!-- ════════ 分类占比表 + 每日趋势图 ════════ -->
    <div class="reports-grid">
      <!-- 分类占比表 -->
      <div class="reports-section">
        <div class="section-title">分类工时占比</div>
        <div class="cat-table">
          <div class="cat-row cat-header">
            <div class="cat-col-name">分类</div>
            <div class="cat-col-hours">工时</div>
            <div class="cat-col-percent">%</div>
          </div>
          <div v-for="c in categoryStats" :key="c.name" class="cat-row">
            <div class="cat-col-name">
              <span class="cat-dot" :style="{ background: c.color }"></span>
              {{ c.name }}
            </div>
            <div class="cat-col-hours">{{ fmtHM(c.minutes) }}</div>
            <div class="cat-col-percent">{{ c.percent }}%</div>
            <div class="cat-bar-track">
              <div class="cat-bar-fill" :style="{ width: c.percent + '%', background: c.color }"></div>
            </div>
          </div>
          <div v-if="categoryStats.length === 0" class="cat-empty">暂无数据</div>
        </div>
      </div>

      <!-- 每日趋势图 -->
      <div class="reports-section">
        <div class="section-title">每日工时趋势</div>
        <div class="chart-canvas-wrap">
          <canvas ref="trendChart"></canvas>
        </div>
      </div>
    </div>

    <!-- ════════ 明细表格 ════════ -->
    <div class="reports-section detail-section">
      <div class="section-title-row">
        <div class="section-title">明细</div>
        <div class="action-btns">
          <button class="export-btn" @click="exportCSV" :disabled="rangeEntries.length === 0">
            ⬇ 导出 CSV
          </button>
          <button class="export-btn" @click="downloadTemplate">
            ⬇ 下载导入模板
          </button>
          <button class="export-btn" @click="showImport = !showImport">
            ⬆ 导入数据
          </button>
        </div>
      </div>
      <!-- 导入区域 -->
      <div v-if="showImport" class="import-area">
        <div class="import-hint">
          1. 下载导入模板<br>
          2. 按模板格式填写数据（日期、成员、任务名称、任务分类、国家、任务开始时间、任务结束时间、工时、备注）<br>
          3. 选择文件后点击"开始导入"
        </div>
        <div class="import-actions">
          <input ref="fileInput" type="file" accept=".csv,.xlsx" class="import-file" @change="onFilePick" />
          <button class="export-btn" @click="doImport" :disabled="!pendingRows || importing">
            {{ importing ? '导入中...' : '开始导入' }}
          </button>
        </div>
        <div v-if="importMsg" class="import-msg" :class="importMsgType">{{ importMsg }}</div>
        <div v-if="pendingRows" class="import-preview">
          预览：共 {{ pendingRows.length }} 条，<button class="link-btn" @click="pendingRows = null">取消</button>
          <div class="preview-table">
            <div class="preview-row preview-header">
              <div>日期</div><div>成员</div><div>任务名称</div><div>分类</div><div>工时</div>
            </div>
            <div v-for="(r, i) in pendingRows.slice(0, 5)" :key="i" class="preview-row">
              <div>{{ r['日期'] }}</div><div>{{ r['成员'] }}</div><div>{{ r['任务名称'] }}</div><div>{{ r['任务分类'] }}</div><div>{{ r['工时'] }}</div>
            </div>
            <div v-if="pendingRows.length > 5" class="preview-more">... 还有 {{ pendingRows.length - 5 }} 条</div>
          </div>
        </div>
      </div>
      <div class="detail-table">
        <div class="detail-row detail-header">
          <div class="detail-col" @click="sortBy('date')">日期 {{ sortArrow('date') }}</div>
          <div class="detail-col" v-if="canViewOthers" @click="sortBy('user')">成员 {{ sortArrow('user') }}</div>
          <div class="detail-col" @click="sortBy('category')">分类 {{ sortArrow('category') }}</div>
          <div class="detail-col" @click="sortBy('description')">描述 {{ sortArrow('description') }}</div>
          <div class="detail-col detail-col-hours" @click="sortBy('minutes')">时长 {{ sortArrow('minutes') }}</div>
        </div>
        <template v-for="e in sortedEntries" :key="e.record_id">
          <div class="detail-row" :class="{ expanded: expandedId === e.record_id }" @click="toggleExpand(e.record_id)">
            <div class="detail-col">{{ fmtDate(e.fields['start_time']) }}</div>
            <div class="detail-col" v-if="canViewOthers">{{ e.fields['user'] || '-' }}</div>
            <div class="detail-col">
              <span class="cat-dot" :style="{ background: categoryColor(e.fields['category']) }"></span>
              {{ e.fields['category'] || '-' }}
            </div>
            <div class="detail-col">{{ e.fields['description'] || '-' }}</div>
            <div class="detail-col detail-col-hours">{{ fmtHM(e.fields['时长(秒)'] ? e.fields['时长(秒)'] / 60 : entryDur(e)) }}</div>
          </div>
          <div v-if="expandedId === e.record_id" class="detail-expanded">
            <div class="detail-grid">
              <div class="detail-field"><span class="detail-label">日期</span><span class="detail-value">{{ fmtFullDate(e.fields['start_time']) }}</span></div>
              <div class="detail-field"><span class="detail-label">成员</span><span class="detail-value">{{ e.fields['user'] || '-' }}</span></div>
              <div class="detail-field"><span class="detail-label">任务名称</span><span class="detail-value">{{ e.fields['description'] || '-' }}</span></div>
              <div class="detail-field"><span class="detail-label">任务分类</span><span class="detail-value">{{ e.fields['category'] || '-' }}</span></div>
              <div class="detail-field"><span class="detail-label">国家</span><span class="detail-value">{{ e.fields['country'] || '-' }}</span></div>
              <div class="detail-field"><span class="detail-label">开始时间</span><span class="detail-value">{{ fmtFullTime(e.fields['start_time']) }}</span></div>
              <div class="detail-field"><span class="detail-label">结束时间</span><span class="detail-value">{{ fmtFullTime(e.fields['end_time']) }}</span></div>
              <div class="detail-field"><span class="detail-label">工时</span><span class="detail-value">{{ fmtHM(e.fields['时长(秒)'] ? e.fields['时长(秒)'] / 60 : entryDur(e)) }}</span></div>
              <div class="detail-field detail-field-full"><span class="detail-label">备注</span><span class="detail-value">{{ e.fields['备注'] || e.fields['remark'] || '-' }}</span></div>
            </div>
          </div>
        </template>
        <div v-if="sortedEntries.length === 0" class="cat-empty">暂无数据</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, inject, nextTick } from 'vue'
import Chart from 'chart.js/auto'

const http = inject('http')
const userName = inject('userName')
const userRole = inject('userRole')
const displayName = inject('displayName')
const isAdmin = inject('isAdmin')
const categories = inject('categories')
const userTeam = inject('userTeam', ref(''))

// ───── 数据状态 ─────
const entries = ref([])
const teamMembers = ref([])
const allTeams = ref([])
const allCategories = ref([])

// ───── 视角切换 ─────
const viewScope = ref('self')
const selectedUser = ref('')
const selectedTeam = ref('')
const memberSearch = ref('')
const showMemberDropdown = ref(false)

const canViewOthers = computed(() => userRole.value === 'admin' || userRole.value === 'team_admin')
const roleLabel = computed(() => {
  const r = userRole.value
  if (r === 'admin') return '管理员'
  if (r === 'team_admin') return '团队管理员'
  return '成员'
})

// 管理员默认看全部总表
if (userRole.value === 'admin') viewScope.value = 'all'

const filteredMembers = computed(() => {
  const q = memberSearch.value.trim().toLowerCase()
  const list = teamMembers.value.map(m => ({ user: m.user, displayName: m.displayName }))
  return q ? list.filter(m => m.user.toLowerCase().includes(q) || (m.displayName || '').toLowerCase().includes(q)) : list
})

function pickMember(u) {
  selectedUser.value = u
  showMemberDropdown.value = false
  loadData()
}

function hideMemberDropdownLater() {
  setTimeout(() => { showMemberDropdown.value = false }, 150)
}

function onScopeChange() {
  selectedUser.value = ''
  selectedTeam.value = ''
  loadData()
}

// ───── 时间区间 ─────
const periodType = ref('week')     // day | week | month | custom
const periodOffset = ref(0)        // 0=当前, -1=上一个...
const customStart = ref('')
const customEnd = ref('')

// 当前区间的起止 (00:00:00 ~ 23:59:59)
const periodRange = computed(() => {
  if (periodType.value === 'custom') {
    const s = customStart.value ? new Date(customStart.value + 'T00:00:00') : null
    const e = customEnd.value ? new Date(customEnd.value + 'T23:59:59') : null
    return { start: s, end: e }
  }
  const now = new Date()
  let start, end
  if (periodType.value === 'day') {
    start = new Date(now); start.setDate(now.getDate() + periodOffset.value); start.setHours(0,0,0,0)
    end = new Date(start); end.setHours(23,59,59,999)
  } else if (periodType.value === 'week') {
    const day = now.getDay() || 7
    const monday = new Date(now); monday.setDate(now.getDate() - day + 1 + periodOffset.value * 7); monday.setHours(0,0,0,0)
    start = monday
    end = new Date(monday); end.setDate(monday.getDate() + 6); end.setHours(23,59,59,999)
  } else if (periodType.value === 'month') {
    start = new Date(now.getFullYear(), now.getMonth() + periodOffset.value, 1, 0,0,0,0)
    end = new Date(now.getFullYear(), now.getMonth() + periodOffset.value + 1, 0, 23,59,59,999)
  }
  return { start, end }
})

const periodLabel = computed(() => {
  const { start, end } = periodRange.value
  if (!start || !end) return '自定义区间'
  const f = (d) => `${d.getMonth()+1}/${d.getDate()}`
  if (periodType.value === 'day') return `${start.getFullYear()}年${start.getMonth()+1}月${start.getDate()}日`
  if (periodType.value === 'week') return `周 ${f(start)} - ${f(end)}`
  if (periodType.value === 'month') return `${start.getFullYear()}年${start.getMonth()+1}月`
  return `${f(start)} - ${f(end)}`
})

function setPeriodType(t) {
  periodType.value = t
  periodOffset.value = 0
  if (t === 'custom') {
    // 默认本周
    const now = new Date()
    const day = now.getDay() || 7
    const monday = new Date(now); monday.setDate(now.getDate() - day + 1)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    customStart.value = fmtDateISO(monday)
    customEnd.value = fmtDateISO(sunday)
  }
}

function onCustomChange() {
  loadData()
}

function goCurrent() {
  periodOffset.value = 0
}

function fmtDateISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth()+1).padStart(2,'0')
  const day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}

// ───── 工时计算 ─────
function entryDur(e) {
  const s = new Date(e.fields['start_time'])
  const en = new Date(e.fields['end_time'])
  const min = Math.max(0, (en - s) / 60000)
  // 过滤异常时长: 超过 24h (1440min) 的条目视为忘记停止计时, 忽略
  return min > 1440 ? 0 : min
}

function fmtHM(min) {
  if (min == null || isNaN(min)) return '0h 0m'
  const m = Math.round(min)
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}m`
}

function fmtDate(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getMonth()+1}/${d.getDate()}`
}

// ───── 分类颜色 ─────
function categoryColor(name) {
  const all = [...(allCategories.value || []), ...(categories.value || [])]
  const c = all.find(c => c.name === name)
  return c?.color || '#6b7280'
}

// ───── 区间内条目 ─────
const rangeEntries = computed(() => {
  const { start, end } = periodRange.value
  if (!start || !end) return []
  return entries.value.filter(e => {
    const s = new Date(e.fields['start_time'])
    return s >= start && s <= end
  })
})

// 区间总工时
const rangeTotalMin = computed(() => rangeEntries.value.reduce((s, e) => s + entryDur(e), 0))

// 活跃天数
const activeDays = computed(() => {
  const days = new Set()
  for (const e of rangeEntries.value) {
    const d = new Date(e.fields['start_time'])
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
  }
  return days.size
})

// 日均工时
const avgDailyMin = computed(() => {
  const days = activeDays.value
  return days > 0 ? rangeTotalMin.value / days : 0
})

// ───── 分类统计 ─────
const categoryStats = computed(() => {
  const map = new Map()
  for (const e of rangeEntries.value) {
    const name = e.fields['category'] || '未分类'
    const min = entryDur(e)
    map.set(name, (map.get(name) || 0) + min)
  }
  const total = rangeTotalMin.value
  return Array.from(map.entries())
    .map(([name, minutes]) => ({
      name,
      minutes,
      color: categoryColor(name),
      percent: total > 0 ? Math.round((minutes / total) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes)
})

// ───── 每日趋势数据 ─────
const dailyTrend = computed(() => {
  const { start, end } = periodRange.value
  if (!start || !end) return { labels: [], data: [] }
  const dayMap = new Map()
  // 遍历区间每一天
  const cur = new Date(start)
  while (cur <= end) {
    const key = fmtDateISO(cur)
    dayMap.set(key, 0)
    cur.setDate(cur.getDate() + 1)
  }
  // 累加每天工时
  for (const e of rangeEntries.value) {
    const d = new Date(e.fields['start_time'])
    const key = fmtDateISO(d)
    if (dayMap.has(key)) {
      dayMap.set(key, dayMap.get(key) + entryDur(e))
    }
  }
  const labels = Array.from(dayMap.keys()).map(k => {
    const d = new Date(k)
    return `${d.getMonth()+1}/${d.getDate()}`
  })
  const data = Array.from(dayMap.values()).map(v => v / 60) // 转小时
  return { labels, data }
})

// ───── 明细表格排序 ─────
const sortKey = ref('date')
const sortDir = ref('desc')

function sortBy(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

function sortArrow(key) {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? '▲' : '▼'
}

// ───── 点击展开详情 ─────
const expandedId = ref(null)

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function fmtFullDate(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fmtFullTime(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2,'0')
  const m = String(d.getMinutes()).padStart(2,'0')
  const s = String(d.getSeconds()).padStart(2,'0')
  return `${fmtFullDate(ts)} ${h}:${m}:${s}`
}

const sortedEntries = computed(() => {
  const list = [...rangeEntries.value]
  const key = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  list.sort((a, b) => {
    let va, vb
    if (key === 'date') { va = new Date(a.fields['start_time']); vb = new Date(b.fields['start_time']) }
    else if (key === 'user') { va = a.fields['user'] || ''; vb = b.fields['user'] || '' }
    else if (key === 'category') { va = a.fields['category'] || ''; vb = b.fields['category'] || '' }
    else if (key === 'description') { va = a.fields['description'] || ''; vb = b.fields['description'] || '' }
    else if (key === 'minutes') { va = entryDur(a); vb = entryDur(b) }
    else { va = 0; vb = 0 }
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
  return list
})

// ───── 导出 CSV ─────
function exportCSV() {
  const list = sortedEntries.value
  if (list.length === 0) return
  const header = ['日期', '成员', '任务名称', '任务分类', '国家', '任务开始时间', '任务结束时间', '工时', '备注']
  const rows = list.map(e => {
    const minutes = Math.round(entryDur(e))
    const hours = (minutes / 60).toFixed(2)
    return [
      fmtFullDate(e.fields['start_time']),
      e.fields['user'] || '',
      (e.fields['description'] || '').replace(/"/g, '""'),
      (e.fields['category'] || '').replace(/"/g, '""'),
      (e.fields['country'] || '').replace(/"/g, '""'),
      fmtFullTime(e.fields['start_time']),
      fmtFullTime(e.fields['end_time']),
      hours,
      (e.fields['备注'] || e.fields['remark'] || '').replace(/"/g, '""'),
    ]
  })
  const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  // 加 BOM 让 Excel 正确识别 UTF-8
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `报表_${periodLabel.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ───── 下载导入模板 ─────
function downloadTemplate() {
  const header = ['日期', '成员', '任务名称', '任务分类', '国家', '任务开始时间', '任务结束时间', '工时', '备注']
  const sample = [
    ['2026-08-30', 'testuser113', '修复登录bug', '开发', '中国', '2026-08-30 09:00:00', '2026-08-30 11:30:00', '2.5', '紧急修复'],
    ['2026-08-30', 'testuser114', '需求评审', '会议', '中国', '2026-08-30 14:00:00', '2026-08-30 15:00:00', '1', ''],
  ]
  const csv = [header, ...sample].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '工时导入模板.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ───── 导入数据 ─────
const showImport = ref(false)
const fileInput = ref(null)
const pendingRows = ref(null)
const importing = ref(false)
const importMsg = ref('')
const importMsgType = ref('')

function onFilePick(e) {
  const file = e.target.files[0]
  if (!file) return
  importMsg.value = ''
  const reader = new FileReader()
  reader.onload = (ev) => {
    try {
      let text = ev.target.result
      // 去掉 BOM
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
      const rows = parseCSV(text)
      if (rows.length === 0) {
        importMsg.value = '文件为空或格式错误'
        importMsgType.value = 'error'
        pendingRows.value = null
        return
      }
      const header = rows[0].map(h => h.trim())
      const dataRows = rows.slice(1).filter(r => r.some(c => c.trim() !== ''))
      // 映射成对象数组
      const mapped = dataRows.map(r => {
        const obj = {}
        header.forEach((h, i) => { obj[h] = (r[i] || '').trim() })
        return obj
      })
      pendingRows.value = mapped
      importMsg.value = `已解析 ${mapped.length} 条数据，点击"开始导入"`
      importMsgType.value = 'success'
    } catch (err) {
      importMsg.value = '解析失败: ' + err.message
      importMsgType.value = 'error'
      pendingRows.value = null
    }
  }
  reader.readAsText(file, 'utf-8')
}

// 简易 CSV 解析（支持引号包裹、逗号分隔）
function parseCSV(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else inQuote = false
      } else cell += ch
    } else {
      if (ch === '"') inQuote = true
      else if (ch === ',') { row.push(cell); cell = '' }
      else if (ch === '\n' || ch === '\r') {
        if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); row = []; cell = '' }
        if (ch === '\r' && text[i + 1] === '\n') i++
      } else cell += ch
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

async function doImport() {
  if (!pendingRows.value || pendingRows.value.length === 0) return
  importing.value = true
  importMsg.value = ''
  try {
    // 把 CSV 中文 key 映射成英文 key, 避免腾讯云 SCF 解析中文 JSON key 出问题
    const mappedRows = pendingRows.value.map(r => ({
      date: r['日期'] || '',
      user: r['成员'] || r['用户'] || '',
      description: r['任务名称'] || r['描述'] || '',
      category: r['任务分类'] || r['分类'] || '',
      country: r['国家'] || '',
      startTime: r['任务开始时间'] || r['开始时间'] || '',
      endTime: r['任务结束时间'] || r['结束时间'] || '',
      hours: r['工时'] || '',
      notes: r['备注'] || r['remark'] || '',
    }))
    const res = await http('/entries/batch', {
      method: 'POST',
      body: {
        rows: mappedRows,
        username: userName.value,
        role: userRole.value,
      },
    })
    if (res.failed > 0 && res.success === 0) {
      // 全部失败 (通常是权限不合规)
      importMsg.value = '导入失败：' + (res.errors?.[0] || '身份不合规')
      importMsgType.value = 'error'
    } else {
      importMsg.value = `导入成功：${res.success || 0} 条，失败：${res.failed || 0} 条`
      importMsgType.value = 'success'
      pendingRows.value = null
      if (fileInput.value) fileInput.value.value = ''
      await loadData()
      // 飞书 batch_create 后立即 search 可能有索引延迟, 延迟 2s 再加载一次确保拿到新数据
      setTimeout(async () => {
        await loadData()
      }, 2000)
    }
  } catch (e) {
    importMsg.value = '导入失败: ' + e.message
    importMsgType.value = 'error'
  } finally {
    importing.value = false
  }
}

// ───── 趋势图 ─────
const trendChart = ref(null)
let trendInstance = null

function renderTrendChart() {
  if (!trendChart.value) return
  if (trendInstance) trendInstance.destroy()

  const { labels, data } = dailyTrend.value
  trendInstance = new Chart(trendChart.value, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '工时(小时)',
        data,
        borderColor: '#00d4ff',
        backgroundColor: 'rgba(0, 212, 255, 0.15)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#00d4ff',
        pointRadius: 4,
        pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => fmtHM(ctx.parsed.y * 60) } },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#64748b', callback: (v) => v + 'h' },
        },
        x: {
          grid: { display: false },
          ticks: { color: '#64748b' },
        },
      },
    },
  })
}

function renderAll() {
  nextTick(() => {
    renderTrendChart()
  })
}

// ───── 加载数据 ─────
// 内存缓存: 同一会话内不重复调 /teams/members 和 /teams
let teamMembersCache = null
let allTeamsCache = null
let teamMembersLoading = null

async function loadTeamMembers() {
  if (!canViewOthers.value) {
    teamMembers.value = []
    allTeams.value = []
    return
  }
  // 命中缓存直接返回
  if (teamMembersCache && allTeamsCache) {
    let items = teamMembersCache
    if (userRole.value === 'team_admin' && userTeam.value) {
      items = items.filter(m => m.team === userTeam.value)
    }
    teamMembers.value = items
    allTeams.value = allTeamsCache
    return
  }
  // 防止并发重复调用
  if (teamMembersLoading) return teamMembersLoading
  teamMembersLoading = (async () => {
    try {
      const [data, teamsRes] = await Promise.all([
        http('/teams/members'),
        http('/teams?page_size=100'),
      ])
      let items = data.items || []
      teamMembersCache = items.map(m => ({
        user: m.display_name || m.username,
        displayName: m.display_name || m.username,
        team: m.team,
      }))
      allTeamsCache = (teamsRes.items || []).map(t => ({ name: t.name }))
      let teamItems = teamMembersCache
      if (userRole.value === 'team_admin' && userTeam.value) {
        teamItems = teamItems.filter(m => m.team === userTeam.value)
      }
      teamMembers.value = teamItems
      allTeams.value = allTeamsCache
    } catch (e) {
      console.error('加载成员列表失败:', e)
      teamMembers.value = []
      allTeams.value = []
    } finally {
      teamMembersLoading = null
    }
  })()
  return teamMembersLoading
}

async function loadData() {
  try {
    const [data] = await Promise.all([
      http('/entries?page_size=500'),
      loadTeamMembers(),
    ])
    const allItems = data.items || []

    const scope = viewScope.value
    if (scope === 'self') {
      const names = new Set([userName.value, displayName.value].filter(Boolean))
      entries.value = names.size ? allItems.filter(e => names.has(e.fields.user)) : []
    } else if (scope === 'member') {
      const name = selectedUser.value || userName.value
      entries.value = name ? allItems.filter(e => e.fields.user === name) : []
    } else if (scope === 'team') {
      const usersInTeam = new Set(
        teamMembers.value.filter(m => m.team === userTeam.value).map(m => m.user)
      )
      entries.value = allItems.filter(e => usersInTeam.has(e.fields.user))
    } else if (scope === 'all' && selectedTeam.value) {
      const usersInTeam = new Set(
        teamMembers.value.filter(m => m.team === selectedTeam.value).map(m => m.user)
      )
      entries.value = allItems.filter(e => usersInTeam.has(e.fields.user))
    } else {
      entries.value = allItems
    }
    renderAll()
  } catch (e) {
    console.error('加载失败:', e)
  }
}

// ───── 监听区间变化, 重新渲染图表 ─────
watch([periodType, periodOffset, customStart, customEnd], () => {
  renderAll()
})

// ───── 初始化 ─────
onMounted(() => {
  // 初始化管理员默认视角
  if (userRole.value === 'admin') {
    viewScope.value = 'all'
  } else if (userRole.value === 'team_admin') {
    viewScope.value = 'team'
  } else {
    viewScope.value = 'self'
  }
  loadData()
})
</script>

<style scoped>
.reports {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

/* ───── 页头 ───── */
.reports-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.reports-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--primary);
  text-shadow: 0 0 12px var(--primary-glow);
  letter-spacing: 0.5px;
}

.page-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ───── 查看对象切换 ───── */
.view-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.view-switch label {
  font-size: 13px;
  color: var(--text-secondary);
}

.view-switch select {
  padding: 6px 32px 6px 12px;
  background-color: var(--surface);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M5 8l5 5 5-5' stroke='%2300d4ff' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
}

.view-switch select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}

.member-search-wrap {
  position: relative;
}

.member-search-input {
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  width: 180px;
}

.member-search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}

.member-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  max-height: 240px;
  overflow-y: auto;
  z-index: 100;
}

.member-option {
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.member-option:hover { background: var(--surface-hover); }
.member-option.active { background: rgba(0, 212, 255, 0.15); color: var(--primary); }
.member-sub { font-size: 11px; color: var(--text-secondary); }
.member-empty { padding: 12px; text-align: center; color: var(--text-secondary); font-size: 13px; }

/* ───── 时间区间选择 ───── */
.period-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.period-tabs {
  display: flex;
  gap: 2px;
  background: var(--surface);
  padding: 3px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}

.period-tabs button {
  padding: 6px 14px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.period-tabs button:hover { color: var(--primary); }
.period-tabs button.active {
  background: var(--primary);
  color: var(--bg);
  font-weight: 500;
  box-shadow: 0 0 12px var(--primary-glow);
}

.period-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-arrow {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-light);
  background: var(--surface);
  color: var(--text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;
}

.nav-arrow:hover:not(:disabled) { background: var(--surface-hover); color: var(--primary); }
.nav-arrow:disabled { opacity: 0.4; cursor: not-allowed; }

.period-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  min-width: 140px;
  text-align: center;
}

.today-btn {
  padding: 6px 12px;
  border: 1px solid var(--border-light);
  background: var(--surface);
  color: var(--text-secondary);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}

.today-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--primary); }
.today-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.custom-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-range input {
  padding: 6px 10px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
}

.custom-range input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15);
}

/* ───── 汇总卡片 ───── */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  transition: all 0.2s;
}

.summary-card:hover {
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
}

.summary-icon {
  font-size: 28px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-light);
  border-radius: var(--radius);
}

.summary-body { flex: 1; }
.summary-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.summary-value { font-size: 20px; font-weight: 600; color: var(--text); }

/* ───── 报表网格 (分类表 + 趋势图) ───── */
.reports-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}

.reports-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 16px;
  text-shadow: 0 0 8px var(--primary-glow);
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-title-row .section-title { margin-bottom: 0; }

.export-btn {
  padding: 6px 12px;
  background: var(--surface-light);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  color: var(--primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.export-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  box-shadow: 0 0 12px var(--primary-glow);
}

.export-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ───── 导入区域 ───── */
.action-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.import-area {
  background: var(--surface-light);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 16px;
}

.import-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.8;
  margin-bottom: 12px;
}

.import-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.import-file {
  font-size: 13px;
  color: var(--text);
  flex: 1;
  min-width: 200px;
}

.import-file::-webkit-file-upload-button {
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  color: var(--primary);
  cursor: pointer;
  margin-right: 8px;
}

.import-msg {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 13px;
}

.import-msg.success { background: rgba(0, 255, 136, 0.1); color: var(--success); }
.import-msg.error { background: rgba(255, 51, 102, 0.1); color: var(--danger); }

.import-preview {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.link-btn {
  background: none;
  border: none;
  color: var(--primary);
  cursor: pointer;
  font-size: 13px;
  text-decoration: underline;
}

.preview-table {
  margin-top: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.preview-row {
  display: grid;
  grid-template-columns: 100px 100px 1fr 100px 60px;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text);
}

.preview-row:last-child { border-bottom: none; }

.preview-header {
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-size: 11px;
}

.preview-more {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
}

/* ───── 分类占比表 ───── */
.cat-table { font-size: 13px; }

.cat-row {
  display: grid;
  grid-template-columns: 1fr 70px 50px 90px;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  align-items: center;
}

.cat-row:last-child { border-bottom: none; }

.cat-header {
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
}

.cat-col-name { display: flex; align-items: center; gap: 8px; }
.cat-col-hours { text-align: right; color: var(--text); }
.cat-col-percent { text-align: right; color: var(--text-secondary); }

.cat-bar-track {
  position: relative;
  height: 4px;
  background: var(--surface-light);
  border-radius: 2px;
  overflow: hidden;
}

.cat-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s;
}

.cat-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cat-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

/* ───── 趋势图 ───── */
.chart-canvas-wrap {
  position: relative;
  height: 280px;
  min-height: 280px;
  display: block;
}

/* ───── 明细表格 ───── */
.detail-section { margin-bottom: 24px; }

.detail-table { font-size: 13px; }

.detail-row {
  display: grid;
  grid-template-columns: 80px 100px 1fr 120px 80px;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  align-items: center;
}

.detail-row:last-child { border-bottom: none; }

.detail-header {
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
  cursor: pointer;
}

.detail-header:hover { color: var(--primary); }

.detail-col { color: var(--text); }
.detail-col-hours { text-align: right; }

/* ───── 点击展开详情 ───── */
.detail-row { cursor: pointer; transition: background 0.15s; }
.detail-row:hover { background: var(--surface-hover); }
.detail-row.expanded { background: rgba(0, 212, 255, 0.08); border-left: 3px solid var(--primary); }

.detail-expanded {
  background: var(--surface-light);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  padding: 16px;
  margin: 4px 0 8px;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px 20px;
}

.detail-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-field-full { grid-column: 1 / -1; }

.detail-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-value {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}

/* ───── 响应式 ───── */
@media (max-width: 768px) {
  .reports { padding: 12px; }
  .summary-cards { grid-template-columns: 1fr 1fr; }
  .reports-grid { grid-template-columns: 1fr; }
  .period-label { min-width: 100px; }
  .detail-row { grid-template-columns: 60px 1fr 80px; gap: 8px; }
  .detail-row .detail-col:nth-child(2),
  .detail-row .detail-col:nth-child(4) { display: none; }
}
</style>
