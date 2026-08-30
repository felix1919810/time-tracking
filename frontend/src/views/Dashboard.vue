<template>
  <div class="dashboard">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <div class="page-title">仪表盘</div>
        <div class="page-subtitle">{{ displayName }} · {{ roleLabel }}</div>
      </div>
      <!-- 切换查看对象: 只有团队管理员和管理员可见 -->
      <div v-if="canViewOthers" class="view-switch">
        <label>查看:</label>
        <select v-model="viewScope" @change="loadData">
          <option value="self">自己 ({{ displayName }})</option>
          <option v-if="userRole === 'team_admin' || userRole === 'admin'" value="team">本团队全部</option>
          <option v-if="userRole === 'admin'" value="all">全部团队</option>
        </select>
        <!-- 选中团队/全部时, 再选具体成员 -->
        <select v-if="viewScope !== 'self'" v-model="selectedUser" @change="loadData">
          <option value="">(全部成员)</option>
          <option v-for="u in teamMembers" :key="u.user" :value="u.user">{{ u.user }}</option>
        </select>
      </div>
      <!-- 周/月切换 + 翻页 -->
      <div class="period-nav">
        <div class="period-tabs">
          <button :class="{ active: period === 'week' }" @click="setPeriod('week')">周</button>
          <button :class="{ active: period === 'month' }" @click="setPeriod('month')">月</button>
        </div>
        <button class="nav-arrow" @click="shiftPeriod(-1)">‹</button>
        <span class="period-text">{{ periodText }}</span>
        <button class="nav-arrow" @click="shiftPeriod(1)">›</button>
        <button class="today-btn" @click="goCurrent">当前</button>
      </div>
    </div>

    <!-- 数字卡片 -->
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">今日工时</div>
        <div class="stat-value">{{ fmtHM(todayMin) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">本周累计</div>
        <div class="stat-value">{{ fmtHM(weekMin) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">本月累计</div>
        <div class="stat-value">{{ fmtHM(monthMin) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ period === 'week' ? '本周' : '本月' }}任务数</div>
        <div class="stat-value">{{ periodEntries.length }}</div>
      </div>
    </div>

    <!-- 图表 -->
    <div class="chart-grid">
      <div class="chart-container chart-fixed">
        <div class="chart-title">{{ period === 'week' ? '本周每日工时' : '本月每日工时' }}（按分类堆叠）</div>
        <div class="chart-canvas-wrap"><canvas ref="barChart"></canvas></div>
      </div>
      <div class="chart-container chart-fixed">
        <div class="chart-title">{{ periodText }} 分类占比</div>
        <div class="chart-canvas-wrap"><canvas ref="pieChart"></canvas></div>
      </div>
    </div>

    <!-- 分类明细 -->
    <div class="chart-container" style="margin-top: 16px;">
      <div class="chart-title">{{ periodText }} 分类明细</div>
      <div class="cat-list">
        <div v-for="c in periodCategoryStats" :key="c.name" class="cat-item">
          <span class="cat-dot" :style="{ background: c.color }"></span>
          <span class="cat-name">{{ c.name }}</span>
          <span class="cat-duration">{{ fmtHM(c.minutes) }}</span>
          <span class="cat-percent">{{ c.percent }}%</span>
        </div>
        <div v-if="periodCategoryStats.length === 0" class="empty-hint">暂无数据</div>
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

const entries = ref([])
const barChart = ref(null)
const pieChart = ref(null)
let barInstance = null
let pieInstance = null

// ───── 权限分级 ─────
// viewScope: self(只看自己) | team(本团队) | all(全部团队)
const viewScope = ref('self')
const selectedUser = ref('')
const teamMembers = ref([])

const roleLabel = computed(() => {
  const r = userRole.value
  if (r === 'admin') return '管理员'
  if (r === 'team_admin') return '团队管理员'
  return '团队成员'
})

const canViewOthers = computed(() => {
  const r = userRole.value
  return r === 'team_admin' || r === 'admin'
})

async function loadTeamMembers() {
  if (!canViewOthers.value) {
    teamMembers.value = []
    return
  }
  try {
    const url = '/entries?page_size=500'
    const data = await http(url)
    const items = data.items || []
    const userSet = new Map()
    for (const i of items) {
      const u = i.fields.user
      if (u && !userSet.has(u)) userSet.set(u, { user: u })
    }
    teamMembers.value = Array.from(userSet.values())
  } catch (e) {
    console.error('加载成员列表失败:', e)
    teamMembers.value = []
  }
}

// ───── 周/月切换 + 翻页 ─────
const period = ref('week') // 'week' | 'month'
const periodOffset = ref(0) // 0=当前, -1=上个, 1=下个

const periodText = computed(() => {
  if (period.value === 'month') {
    return getCurrentPeriodLabel()
  }
  return getCurrentPeriodLabel()
})

function getCurrentPeriodLabel() {
  const { start, end } = getPeriodRange()
  if (period.value === 'month') {
    return `${start.getFullYear()}年${start.getMonth() + 1}月`
  }
  // 周
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`
}

function getPeriodRange() {
  const now = new Date()
  if (period.value === 'week') {
    const day = now.getDay() || 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - day + 1 + periodOffset.value * 7)
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)
    return { start: monday, end: sunday }
  }
  // month
  const monthStart = new Date(now.getFullYear(), now.getMonth() + periodOffset.value, 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + periodOffset.value + 1, 0, 23, 59, 59, 999)
  return { start: monthStart, end: monthEnd }
}

function setPeriod(p) {
  period.value = p
  periodOffset.value = 0
  renderAll()
}

function shiftPeriod(n) {
  periodOffset.value += n
  renderAll()
}

// ───── 当前时段的条目 ─────
const periodEntries = computed(() => {
  const { start, end } = getPeriodRange()
  return entries.value.filter(e => {
    const s = new Date(e.fields['start_time'])
    return s >= start && s <= end
  })
})

// ───── 统计 ─────
const todayMin = computed(() => {
  const today = new Date().toDateString()
  return entries.value
    .filter(e => new Date(e.fields['start_time']).toDateString() === today)
    .reduce((s, e) => s + entryDur(e), 0)
})

const weekMin = computed(() => {
  const now = new Date()
  const day = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1)
  monday.setHours(0, 0, 0, 0)
  return entries.value
    .filter(e => new Date(e.fields['start_time']) >= monday)
    .reduce((s, e) => s + entryDur(e), 0)
})

const monthMin = computed(() => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return entries.value
    .filter(e => new Date(e.fields['start_time']) >= monthStart)
    .reduce((s, e) => s + entryDur(e), 0)
})

// ───── 当前时段的分类统计 ─────
const periodCategoryStats = computed(() => {
  const stats = {}
  let total = 0
  for (const e of periodEntries.value) {
    const cat = e.fields['category'] || '其他'
    const dur = entryDur(e)
    stats[cat] = (stats[cat] || 0) + dur
    total += dur
  }
  return Object.entries(stats)
    .map(([name, minutes]) => {
      const c = categories.value.find(c => c.name === name)
      return {
        name,
        color: c?.color || '#6b7280',
        minutes,
        percent: total > 0 ? Math.round((minutes / total) * 100) : 0,
      }
    })
    .sort((a, b) => b.minutes - a.minutes)
})

function entryDur(e) {
  const s = new Date(e.fields['start_time'])
  const en = new Date(e.fields['end_time'])
  return Math.max(0, (en - s) / 60000)
}

function fmtHM(min) {
  min = Math.round(min)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// ───── 柱状图（横轴=日期，纵轴=工时，按分类堆叠）─────
function renderBarChart() {
  if (!barChart.value) return
  if (barInstance) barInstance.destroy()

  const { start, end } = getPeriodRange()
  const labels = []
  const dates = []

  if (period.value === 'week') {
    const weekDays = ['一', '二', '三', '四', '五', '六', '日']
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      labels.push(weekDays[i] + ' ' + (d.getMonth() + 1) + '/' + d.getDate())
      dates.push(d.toDateString())
    }
  } else {
    // 月：每天一个柱子
    const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), i)
      labels.push(String(i))
      dates.push(d.toDateString())
    }
  }

  // 按分类堆叠
  const datasets = categories.value.map(cat => {
    const data = dates.map(dateStr => {
      return periodEntries.value
        .filter(e =>
          (e.fields['category'] === cat.name || (!e.fields['category'] && cat.name === '其他')) &&
          new Date(e.fields['start_time']).toDateString() === dateStr
        )
        .reduce((s, e) => s + entryDur(e) / 60, 0)
    })
    return {
      label: cat.name,
      data,
      backgroundColor: cat.color,
      borderRadius: 4,
    }
  })

  barInstance = new Chart(barChart.value, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#f0f1f2' }, ticks: { callback: (v) => v + 'h' } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtHM(ctx.parsed.y * 60)}`,
          },
        },
      },
    },
  })
}

// ───── 饼图（当前时段分类占比）─────
function renderPieChart() {
  if (!pieChart.value) return
  if (pieInstance) pieInstance.destroy()

  const stats = periodCategoryStats.value
  if (stats.length === 0) {
    pieInstance = new Chart(pieChart.value, {
      type: 'pie',
      data: { labels: ['暂无数据'], datasets: [{ data: [1], backgroundColor: ['#e5e7eb'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    })
    return
  }

  pieInstance = new Chart(pieChart.value, {
    type: 'pie',
    data: {
      labels: stats.map(s => s.name),
      datasets: [{
        data: stats.map(s => Math.round(s.minutes)),
        backgroundColor: stats.map(s => s.color),
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${fmtHM(ctx.parsed)} (${stats[ctx.dataIndex].percent}%)`,
          },
        },
      },
    },
  })
}

function renderAll() {
  nextTick(() => {
    renderBarChart()
    renderPieChart()
  })
}

// ───── 加载数据 ─────
async function loadData() {
  try {
    let url = '/entries?page_size=500'
    const r = userRole.value
    if (r === 'member' || viewScope.value === 'self') {
      // 只看自己
      if (displayName.value) {
        url += '&user=' + encodeURIComponent(displayName.value)
      }
    } else if (viewScope.value === 'team' || viewScope.value === 'all') {
      // team/all 模式: 选了具体成员按 user 过滤; 否则全部
      if (selectedUser.value) {
        url += '&user=' + encodeURIComponent(selectedUser.value)
      }
    }
    const data = await http(url)
    entries.value = data.items || []
    // 同步刷新可查看的成员列表
    await loadTeamMembers()
    renderAll()
  } catch (e) {
    console.error('加载失败:', e)
  }
}

// 一键定位到当前周/月
function goCurrent() {
  periodOffset.value = 0
  renderAll()
}

// 监听时段变化，重渲染图表
watch([period, periodOffset], () => renderAll())

onMounted(() => {
  if (userName.value) loadData()
})
</script>

<style scoped>
.dashboard {
  max-width: 1200px;
  margin: 0 auto;
}

.page-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.cat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cat-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg);
  border-radius: 6px;
}

.cat-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.cat-name {
  flex: 1;
  font-weight: 500;
}

.cat-duration {
  color: var(--text-secondary);
  font-size: 13px;
}

.cat-percent {
  color: var(--primary);
  font-weight: 600;
  min-width: 40px;
  text-align: right;
}

.empty-hint {
  text-align: center;
  color: var(--text-secondary);
  padding: 16px;
}

/* 周/月切换栏 */
.period-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.period-tabs {
  display: flex;
  gap: 2px;
  background: var(--bg);
  border-radius: 6px;
  padding: 2px;
}

.period-tabs button {
  padding: 4px 12px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
}

.period-tabs button.active {
  background: var(--surface);
  color: var(--primary);
  font-weight: 500;
  box-shadow: var(--shadow);
}

.period-text {
  font-weight: 600;
  min-width: 120px;
  text-align: center;
}

/* 仪表盘图表固定高度，防止 Chart.js 无限拉长 */
.chart-fixed {
  height: 340px;
  display: flex;
  flex-direction: column;
}

.chart-canvas-wrap {
  flex: 1;
  position: relative;
  min-height: 0;
}

.chart-canvas-wrap canvas {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
}
</style>
