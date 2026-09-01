<template>
  <div class="dashboard">
    <!-- 页头 -->
    <div class="dash-header">
      <div class="dash-title-wrap">
        <div class="page-title">仪表盘</div>
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

    <!-- ════════ 分区 1: 固定指标 (不受日期选择影响) ════════ -->
    <div class="dash-section section-fixed">
      <div class="section-title">📊 当前工时快览</div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon">📅</div>
          <div class="stat-body">
            <div class="stat-label">今日工时</div>
            <div class="stat-value">{{ fmtHM(todayMin) }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📆</div>
          <div class="stat-body">
            <div class="stat-label">本周累计</div>
            <div class="stat-value">{{ fmtHM(weekMin) }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🗓</div>
          <div class="stat-body">
            <div class="stat-label">本月累计</div>
            <div class="stat-value">{{ fmtHM(monthMin) }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">✓</div>
          <div class="stat-body">
            <div class="stat-label">本月任务数</div>
            <div class="stat-value">{{ monthTaskCount }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ════════ 分区 2: 动态分析 (跟随日期选择, 日期按钮在此区顶部) ════════ -->
    <div class="dash-section section-dynamic">
      <!-- 日期选择栏 (属于变化模块) -->
      <div class="dynamic-header">
        <div class="section-title">📈 时段分析</div>
        <div class="period-nav">
          <div class="period-tabs">
            <button :class="{ active: period === 'day' }" @click="setPeriod('day')">日</button>
            <button :class="{ active: period === 'week' }" @click="setPeriod('week')">周</button>
            <button :class="{ active: period === 'month' }" @click="setPeriod('month')">月</button>
          </div>
          <button class="nav-arrow" @click="shiftPeriod(-1)">‹</button>
          <span class="period-text">{{ periodText }}</span>
          <button class="nav-arrow" @click="shiftPeriod(1)">›</button>
          <button class="today-btn" @click="goCurrent">当前</button>
        </div>
      </div>

      <!-- 每日工时柱状图 + 分类占比饼图 -->
      <div class="chart-grid">
        <div class="chart-container">
          <div class="chart-title">{{ periodText }} 每日工时（按分类堆叠）</div>
          <div class="chart-canvas-wrap"><canvas ref="barChart"></canvas></div>
        </div>
        <div class="chart-container">
          <div class="chart-title">{{ periodText }} 分类占比</div>
          <div class="chart-canvas-wrap"><canvas ref="pieChart"></canvas></div>
        </div>
      </div>

      <!-- 趋势折线图 -->
      <div class="chart-container" style="margin-top: 16px;">
        <div class="chart-title">工时趋势（最近 {{ trendDays }} 天）</div>
        <div class="chart-canvas-wrap"><canvas ref="trendChart"></canvas></div>
      </div>

      <!-- 成员对比柱状图 (团队管理员/管理员可见) -->
      <div v-if="canViewOthers" class="chart-container" style="margin-top: 16px;">
        <div class="chart-title">成员工时对比（{{ periodText }}）</div>
        <div class="chart-canvas-wrap"><canvas ref="memberChart"></canvas></div>
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

const entries = ref([])
const barChart = ref(null)
const pieChart = ref(null)
const trendChart = ref(null)
const memberChart = ref(null)
let barInstance = null
let pieInstance = null
let trendInstance = null
let memberInstance = null

// ───── 权限分级 (照搬 ListView) ─────
const viewScope = ref(localStorage.getItem('tt_view_scope') || (userRole.value === 'admin' ? 'all' : 'self'))
const selectedUser = ref(localStorage.getItem('tt_selected_user') || '')
const selectedTeam = ref(localStorage.getItem('tt_selected_team') || '')
watch(viewScope, (v) => localStorage.setItem('tt_view_scope', v))
watch(selectedUser, (v) => localStorage.setItem('tt_selected_user', v))
watch(selectedTeam, (v) => localStorage.setItem('tt_selected_team', v))
const teamMembers = ref([])
const allTeams = ref([])
const memberSearch = ref('')
const showMemberDropdown = ref(false)
const allCategories = ref(JSON.parse(localStorage.getItem('tt_all_categories') || '[]'))

const filteredMembers = computed(() => {
  const q = memberSearch.value.trim().toLowerCase()
  if (!q) return teamMembers.value
  return teamMembers.value.filter(u => {
    const name = (u.user || '').toLowerCase()
    const disp = (u.displayName || '').toLowerCase()
    return name.includes(q) || disp.includes(q)
  })
})

function pickMember(user) {
  selectedUser.value = user
  showMemberDropdown.value = false
  memberSearch.value = ''
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
    allTeams.value = []
    return
  }
  try {
    // 先拿正式团队列表 (团队表), 作为白名单
    const [data, teamsRes] = await Promise.all([
      http('/teams/members'),
      http('/teams?page_size=100'),
    ])
    const validTeamNames = new Set((teamsRes.items || []).map(t => t.name))
    let items = data.items || []
    if (userRole.value === 'team_admin' && userTeam.value) {
      items = items.filter(m => m.team === userTeam.value)
    }
    teamMembers.value = items.map(m => ({
      user: m.display_name || m.username,
      displayName: m.display_name || m.username,
      team: m.team,
    }))
    // allTeams 只显示团队表里正式存在的团队
    allTeams.value = (teamsRes.items || []).map(t => ({ name: t.name }))
  } catch (e) {
    console.error('加载成员列表失败:', e)
    teamMembers.value = []
    allTeams.value = []
  }
}

async function loadAllCategories() {
  try {
    const res = await http('/categories?page_size=500')
    const fresh = res.items || []
    if (!fresh.find(c => c.name === '其他')) {
      fresh.push({ name: '其他', color: '#6b7280' })
    }
    allCategories.value = fresh
    localStorage.setItem('tt_all_categories', JSON.stringify(fresh))
  } catch (e) {
    console.error('加载分类失败:', e)
  }
}

function categoryColor(name) {
  const teamCat = allCategories.value.find(c => c.name === name)
  if (teamCat && teamCat.color) return teamCat.color
  const globalCat = categories.value.find(c => c.name === name)
  if (globalCat && globalCat.color) return globalCat.color
  return '#6b7280'
}

// ───── 日/周/月切换 + 翻页 ─────
const period = ref('week') // 'day' | 'week' | 'month'
const periodOffset = ref(0) // 0=当前, -1=上个, 1=下个

const periodText = computed(() => getCurrentPeriodLabel())

function getCurrentPeriodLabel() {
  const { start, end } = getPeriodRange()
  if (period.value === 'month') {
    return `${start.getFullYear()}年${start.getMonth() + 1}月`
  }
  if (period.value === 'day') {
    return `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`
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
  if (period.value === 'day') {
    const d = new Date(now)
    d.setDate(now.getDate() + periodOffset.value)
    d.setHours(0, 0, 0, 0)
    const end = new Date(d)
    end.setHours(23, 59, 59, 999)
    return { start: d, end }
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

// ───── 快捷指标 (跟随当前查看视角: entries 已按 viewScope/selectedUser/selectedTeam 过滤) ─────
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

const monthTaskCount = computed(() => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return entries.value.filter(e => new Date(e.fields['start_time']) >= monthStart).length
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
    .map(([name, minutes]) => ({
      name,
      color: categoryColor(name),
      minutes,
      percent: total > 0 ? Math.round((minutes / total) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes)
})

function entryDur(e) {
  const s = new Date(e.fields['start_time'])
  const en = new Date(e.fields['end_time'])
  const min = Math.max(0, (en - s) / 60000)
  // 过滤异常时长: 超过 24h (1440min) 的条目视为忘记停止计时, 忽略
  return min > 1440 ? 0 : min
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
  } else if (period.value === 'day') {
    labels.push('当日 ' + (start.getMonth() + 1) + '/' + start.getDate())
    dates.push(start.toDateString())
  } else {
    const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), i)
      labels.push(String(i))
      dates.push(d.toDateString())
    }
  }

  const stats = periodCategoryStats.value
  const datasets = stats.map(cat => {
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
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtHM(ctx.parsed.y * 60)}` } },
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
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmtHM(ctx.parsed)} (${stats[ctx.dataIndex].percent}%)` } },
      },
    },
  })
}

// ───── 趋势折线图 (最近 N 天每日总工时) ─────
const trendDays = ref(7)

function renderTrendChart() {
  if (!trendChart.value) return
  if (trendInstance) trendInstance.destroy()

  const labels = []
  const data = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = trendDays.value - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    labels.push((d.getMonth() + 1) + '/' + d.getDate())
    const dayStr = d.toDateString()
    const total = entries.value
      .filter(e => new Date(e.fields['start_time']).toDateString() === dayStr)
      .reduce((s, e) => s + entryDur(e) / 60, 0)
    data.push(Math.round(total * 100) / 100)
  }

  trendInstance = new Chart(trendChart.value, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '每日工时',
        data,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: '#6366f1',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#f0f1f2' }, ticks: { callback: (v) => v + 'h' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => fmtHM(ctx.parsed.y * 60) } },
      },
    },
  })
}

// ───── 成员对比柱状图 (团队管理员看本团队, 管理员看全部) ─────
function renderMemberChart() {
  if (!memberChart.value) return
  if (memberInstance) memberInstance.destroy()

  const { start, end } = getPeriodRange()
  // 按 user 汇总当前时段工时
  const userMin = {}
  for (const e of periodEntries.value) {
    const u = e.fields['user'] || '未知'
    userMin[u] = (userMin[u] || 0) + entryDur(e)
  }
  const sorted = Object.entries(userMin)
    .map(([user, min]) => ({ user, min }))
    .sort((a, b) => b.min - a.min)
    .slice(0, 15) // 最多显示 15 个成员

  memberInstance = new Chart(memberChart.value, {
    type: 'bar',
    data: {
      labels: sorted.map(s => s.user),
      datasets: [{
        label: '工时',
        data: sorted.map(s => Math.round(s.min / 60 * 100) / 100),
        backgroundColor: '#6366f1',
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: '#f0f1f2' }, ticks: { callback: (v) => v + 'h' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => fmtHM(ctx.parsed.y * 60) } },
      },
    },
  })
}

function renderAll() {
  nextTick(() => {
    renderBarChart()
    renderPieChart()
    renderTrendChart()
    if (canViewOthers.value) renderMemberChart()
  })
}

// ───── 加载数据 (3 个网络请求并行, 总耗时 ≈ max 而非 sum) ─────
async function loadData() {
  try {
    const [data] = await Promise.all([
      http('/entries?page_size=500'),
      loadTeamMembers(),
      loadAllCategories(),
    ])
    const allItems = data.items || []

    const scope = viewScope.value
    if (scope === 'self') {
      // 飞书工时表 user 字段存的是用户名 (如 testuser113), 不是姓名
      // 用 userName 匹配; displayName 兜底
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

/* ───── 顶部 ───── */
.dash-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
  padding: 12px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(8px);
  box-shadow: var(--shadow);
}

.dash-title-wrap {
  flex: 0 0 auto;
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  text-shadow: 0 0 8px var(--primary-glow);
}

.page-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.view-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;
}

.view-switch label {
  font-size: 13px;
  color: var(--text-secondary);
}

.view-switch select {
  padding: 4px 32px 4px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  font-size: 14px;
  background-color: var(--bg);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M5 8l5 5 5-5' stroke='%2300d4ff' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
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
  padding: 4px 8px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  font-size: 13px;
  width: 140px;
  background: var(--bg);
  color: var(--text);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.member-search-input::placeholder {
  color: var(--text-secondary);
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
  z-index: 100;
  margin-top: 4px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  max-height: 240px;
  overflow-y: auto;
  width: 200px;
}

.member-option {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  transition: background 0.15s;
}

.member-option:hover {
  background: var(--surface-hover);
}

.member-option.active {
  background: rgba(0, 212, 255, 0.15);
  color: var(--primary);
}

.member-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: 4px;
}

.member-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.period-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.period-tabs {
  display: flex;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  overflow: hidden;
}

.period-tabs button {
  padding: 4px 10px;
  border: none;
  background: var(--surface-light);
  font-size: 13px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}

.period-tabs button:hover {
  background: var(--surface-hover);
  color: var(--primary);
}

.period-tabs button.active {
  background: var(--primary);
  color: var(--bg);
  box-shadow: 0 0 12px var(--primary-glow);
}

.nav-arrow {
  padding: 6px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--surface-light);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
}

.nav-arrow:hover {
  background: var(--surface-hover);
  color: var(--primary);
  text-shadow: 0 0 8px var(--primary-glow);
}

.period-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  min-width: 80px;
  text-align: center;
}

.today-btn {
  padding: 4px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--surface-light);
  font-size: 13px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
}

.today-btn:hover {
  background: var(--surface-hover);
  color: var(--primary);
}

/* ───── 分区 ───── */
.dash-section {
  margin-bottom: 32px;
}

/* 固定模块: 深色表面, 圆角卡片感 */
.section-fixed {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
}

/* 动态模块: 深色表面, 顶部带日期选择栏 */
.section-dynamic {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
}

/* 动态模块顶部: 标题 + 日期选择 并排 */
.dynamic-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--border-light);
}

.dynamic-header .section-title {
  margin-bottom: 0;
  border-bottom: none;
  padding-bottom: 0;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--primary);
  text-shadow: 0 0 8px var(--primary-glow);
}

/* ───── 快捷指标卡片 ───── */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  background: var(--surface-light);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  transition: box-shadow 0.2s, border-color 0.2s;
}

.stat-card:hover {
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
}

.stat-icon {
  font-size: 28px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-hover);
  border-radius: 10px;
}

.stat-body {
  flex: 1;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
}

/* ───── 图表区 ───── */
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chart-container {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.chart-container:hover {
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
}

.chart-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 16px;
}

.chart-canvas-wrap {
  position: relative;
  height: 280px;
  min-height: 280px;
  display: block;
}

/* ───── 分类明细 ───── */
.cat-list {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
}

.cat-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.cat-item:last-child {
  border-bottom: none;
}

.cat-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 6px currentColor;
}

.cat-name {
  flex: 1;
  font-size: 14px;
  color: var(--text);
}

.cat-duration {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}

.cat-percent {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 40px;
  text-align: right;
}

.empty-hint {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
}

/* ───── 响应式 ───── */
@media (max-width: 768px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .chart-grid {
    grid-template-columns: 1fr;
  }
  .dash-header {
    flex-direction: column;
    align-items: stretch;
  }
  .view-switch {
    margin-left: 0;
  }
}
</style>
