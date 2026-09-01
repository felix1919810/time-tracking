<template>
  <div class="day-view">
    <!-- 固定顶部栏 -->
    <div class="day-toolbar">
      <div class="toolbar-left">
        <button class="nav-arrow" @click="shiftDay(-1)">‹</button>
        <span class="day-range">{{ dayLabel }}</span>
        <button class="nav-arrow" @click="shiftDay(1)">›</button>
        <button class="today-btn" @click="goToday">今天</button>
      </div>
      <!-- 计时器 (管理员不显示) -->
      <div v-if="userRole !== 'admin'" class="toolbar-timer" :class="{ 'is-running': activeTimer }" :style="activeTimer ? { background: activeTimer.color + '22', borderColor: activeTimer.color } : {}">
        <template v-if="activeTimer">
          <span class="timer-pulse" :style="{ background: activeTimer.color }"></span>
          <span class="timer-desc">{{ activeTimer.description || '(无描述)' }}</span>
          <span class="timer-cat" :style="{ color: activeTimer.color }">{{ activeTimer.category }}</span>
          <span class="timer-elapsed">{{ timerElapsedText }}</span>
          <button class="timer-stop" @click="stopActiveTimer" title="完成计时">⏹</button>
        </template>
        <template v-else>
          <span class="timer-idle">⏱</span>
          <span class="timer-idle-text">未计时</span>
          <button class="timer-start" @click="openStartTimer" title="开始计时">▶ 开始</button>
        </template>
      </div>
      <div class="toolbar-right">
        <div v-if="canViewOthers" class="view-switch">
          <label>查看:</label>
          <select v-model="viewScope" @change="onScopeChange">
            <option v-if="userRole !== 'admin'" value="self">自己 ({{ displayName }})</option>
            <option v-if="userRole === 'team_admin'" value="team">本团队总表</option>
            <option v-if="userRole === 'admin'" value="all">全部总表</option>
            <option value="member">指定成员个人表</option>
          </select>
          <div v-if="viewScope === 'member'" class="member-search-wrap">
            <input v-model="memberSearch" class="member-search-input" placeholder="检索成员..." @focus="showMemberDropdown = true" @blur="hideMemberDropdownLater" />
            <div v-if="showMemberDropdown" class="member-dropdown">
              <div class="member-option" :class="{ active: selectedUser === '' }" @mousedown="pickMember('')">(全部成员)</div>
              <div v-for="u in filteredMembers" :key="u.user" class="member-option" :class="{ active: selectedUser === u.user }" @mousedown="pickMember(u.user)">
                {{ u.user }}
                <span v-if="u.displayName && u.displayName !== u.user" class="member-sub">{{ u.displayName }}</span>
              </div>
              <div v-if="filteredMembers.length === 0" class="member-empty">无匹配成员</div>
            </div>
          </div>
          <select v-if="viewScope === 'all' && userRole === 'admin'" v-model="selectedTeam" @change="filterEntries">
            <option value="">(全部团队)</option>
            <option v-for="t in allTeams" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
        <label class="show-name-toggle">
          <input type="checkbox" v-model="showUserName" />
          <span>显示姓名</span>
        </label>
        <div class="zoom-control">
          <span class="zoom-label">密度</span>
          <input type="range" min="32" max="240" step="16" :value="hourPx" @input="hourPx = Number($event.target.value)" />
          <span class="zoom-value">{{ hourPx }}px/h</span>
        </div>
      </div>
    </div>

    <!-- 日视图主体: 左时间轴 + 右条目区 -->
    <div class="day-cal" ref="calRef">
      <div class="time-col">
        <div class="time-head"></div>
        <div class="time-cell" v-for="h in 24" :key="h - 1" :style="{ height: hourPx + 'px' }">
          {{ String(h - 1).padStart(2, '0') }}:00
        </div>
      </div>
      <div class="day-main">
        <div class="day-head" :class="{ today: isToday }">
          <div class="dow">{{ weekdayLabel }}</div>
          <div class="dnum">{{ dayNumber }}</div>
          <div class="dtotal" :class="{ has: dayTotalMin > 0 }">
            {{ dayTotalMin > 0 ? fmtHM(dayTotalMin) : '—' }}
          </div>
        </div>
        <div class="day-body" :style="{ height: (24 * hourPx) + 'px' }">
          <div v-if="isToday" class="now-line" :style="{ top: nowOffsetPx + 'px' }"></div>
          <div
            v-for="e in dayEntriesList"
            :key="e.record_id"
            class="entry"
            :class="{ 'is-running': !e.fields['end_time'], 'is-short': isShortEntry(e) }"
            :style="entryStyle(e)"
            @click.stop="openEdit(e)"
          >
            <div class="e-bar" :style="{ background: entryColor(e) }"></div>
            <div class="e-content">
              <div class="e-title">
                <template v-if="showUserName">{{ e.fields['user'] || '?' }}：</template>{{ e.fields['description'] || '(无描述)' }}
                <span v-if="!e.fields['end_time']" class="running-tag">进行中</span>
              </div>
              <div class="e-meta">
                <span class="e-cat" :style="{ color: entryColor(e) }">{{ e.fields['category'] || '其他' }}</span>
                <span class="e-time">{{ entryTimeRange(e) }}</span>
                <span class="e-dur">{{ fmtHM(entryDurationMin(e)) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 当天合计 -->
    <div class="day-sum">
      当天合计：<strong>{{ fmtHM(dayTotalMin) }}</strong>
    </div>

    <!-- 开始计时弹窗 -->
    <div v-if="showStartModal" class="modal-mask" @click.self="showStartModal = false">
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">开始计时</div>
          <button class="modal-close" @click="showStartModal = false">×</button>
        </div>
        <div class="form-field">
          <label>任务名 <span class="required">*</span></label>
          <input v-model="timerForm.description" placeholder="你在做什么？" autofocus />
        </div>
        <div class="form-field">
          <label>任务分类 <span class="required">*</span></label>
          <select v-model="timerForm.category">
            <option v-for="c in teamCategories" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
        </div>
        <div class="form-field">
          <label>国家</label>
          <div class="country-search-wrap">
            <input v-model="timerForm.country" placeholder="检索国家..." class="country-search-input" @focus="showCountryDropdown = true" @blur="hideCountryDropdownLater" />
            <div v-if="showCountryDropdown" class="country-dropdown">
              <div v-for="c in filteredCountries" :key="c.record_id" class="country-option" :class="{ active: timerForm.country === c.name }" @mousedown="pickCountry(c.name)">
                <span>{{ c.name }}</span>
                <span class="country-code">{{ c.code }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="form-field">
          <label>备注</label>
          <textarea v-model="timerForm.notes" placeholder="可选"></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showStartModal = false">取消</button>
          <button class="btn btn-primary" @click="startTimer" :disabled="!timerForm.description || !timerForm.category">确认开始</button>
        </div>
      </div>
    </div>

    <!-- 编辑条目弹窗 -->
    <div v-if="showEditModal" class="modal-mask" @click.self="showEditModal = false">
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">编辑条目</div>
          <button class="modal-close" @click="showEditModal = false">×</button>
        </div>
        <div class="form-field">
          <label>任务名</label>
          <input v-model="editForm.description" />
        </div>
        <div class="form-field">
          <label>任务分类</label>
          <select v-model="editForm.category">
            <option v-for="c in teamCategories" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
        </div>
        <div class="form-field">
          <label>国家</label>
          <div class="country-search-wrap">
            <input
              v-model="editForm.country"
              placeholder="检索国家..."
              class="country-search-input"
              @focus="showEditCountryDropdown = true"
              @blur="hideEditCountryDropdownLater"
            />
            <div v-if="showEditCountryDropdown" class="country-dropdown">
              <div
                v-for="c in filteredEditCountries"
                :key="c.record_id"
                class="country-option"
                :class="{ active: editForm.country === c.name }"
                @mousedown="pickEditCountry(c.name)"
              >
                <span>{{ c.name }}</span>
                <span class="country-code">{{ c.code }}</span>
              </div>
              <div v-if="filteredEditCountries.length === 0" class="country-empty">无匹配</div>
            </div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>开始时间</label>
            <input type="datetime-local" v-model="editForm.startTime" />
          </div>
          <div class="form-field">
            <label>结束时间</label>
            <input type="datetime-local" v-model="editForm.endTime" />
          </div>
        </div>
        <div class="form-field">
          <label>备注</label>
          <textarea v-model="editForm.notes" rows="2"></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-danger" @click="deleteEntry">删除</button>
          <button class="btn btn-secondary" @click="showEditModal = false">取消</button>
          <button class="btn btn-primary" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject, watch, nextTick } from 'vue'

const http = inject('http')
const userName = inject('userName')
const userRole = inject('userRole')
const displayName = inject('displayName')
const activeTimer = inject('activeTimer')
const startActiveTimer = inject('startActiveTimer')
const stopActiveTimer = inject('stopActiveTimer')
const timerElapsedText = inject('timerElapsedText')
const currentPage = inject('currentPage')
const setPage = inject('setPage')

const currentTeam = inject('userTeam')
const teamCategories = ref([{ name: '其他', color: '#6b7280' }])
const allCategories = ref(
  (() => {
    try {
      const cached = localStorage.getItem('tt_all_categories')
      if (cached) return JSON.parse(cached)
    } catch (e) {}
    return [{ name: '其他', color: '#6b7280' }]
  })()
)

// ───── 数据 ─────
const entries = ref([])
const hourPx = ref(Number(localStorage.getItem('tt_hour_px')) || 80)
// 显示姓名开关: 全局共享 (从 App.vue inject)
const showUserName = inject('showUserName')
// 持久化密度
watch(hourPx, (v) => localStorage.setItem('tt_hour_px', String(v)))

// ───── 权限分级 ─────
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
  filterEntries()
}

function hideMemberDropdownLater() {
  setTimeout(() => { showMemberDropdown.value = false }, 150)
}

function onScopeChange() {
  selectedUser.value = ''
  selectedTeam.value = ''
  filterEntries()
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

// ───── 分类加载 ─────
async function loadAllCategories() {
  try {
    const res = await http('/categories?page_size=500')
    let items = res.items || []
    const seen = new Map()
    for (const c of items) {
      if (!seen.has(c.name)) seen.set(c.name, c)
    }
    items = Array.from(seen.values())
    if (!items.find(c => c.name === '其他')) {
      items.unshift({ name: '其他', color: '#6b7280' })
    }
    allCategories.value = items
    localStorage.setItem('tt_all_categories', JSON.stringify(items))
  } catch (e) {
    console.error('加载所有分类失败:', e)
  }
}

async function loadTeamCategories() {
  if (userRole.value === 'admin') {
    try {
      const res = await http('/categories?page_size=500')
      let items = res.items || []
      const seen = new Map()
      for (const c of items) {
        if (!seen.has(c.name)) seen.set(c.name, c)
      }
      items = Array.from(seen.values())
      if (!items.find(c => c.name === '其他')) {
        items.unshift({ name: '其他', color: '#6b7280' })
      }
      teamCategories.value = items
    } catch (e) {
      console.error('加载所有团队分类失败:', e)
      teamCategories.value = [{ name: '其他', color: '#6b7280' }]
    }
    return
  }
  const team = currentTeam.value
  if (!team) {
    teamCategories.value = [{ name: '其他', color: '#6b7280' }]
    return
  }
  try {
    const res = await http(`/categories?team=${encodeURIComponent(team)}`)
    const items = res.items || []
    if (!items.find(c => c.name === '其他')) {
      items.unshift({ name: '其他', color: '#6b7280' })
    }
    teamCategories.value = items
  } catch (e) {
    console.error('加载团队分类失败:', e)
    teamCategories.value = [{ name: '其他', color: '#6b7280' }]
  }
}

async function loadCategoriesForUser(user) {
  if (!user) return
  teamCategories.value = [{ name: '其他', color: '#6b7280' }]
  const member = teamMembers.value.find(m => m.user === user || m.displayName === user)
  const team = member?.team
  if (!team) {
    await loadTeamCategories()
    return
  }
  try {
    const res = await http(`/categories?team=${encodeURIComponent(team)}`)
    let items = res.items || []
    if (!items.find(c => c.name === '其他')) {
      items.unshift({ name: '其他', color: '#6b7280' })
    }
    teamCategories.value = items
  } catch (e) {
    console.error('按团队加载分类失败:', e)
    teamCategories.value = [{ name: '其他', color: '#6b7280' }]
  }
}

// ───── 成员加载 ─────
async function loadTeamMembers() {
  if (!canViewOthers.value) {
    teamMembers.value = []
    return
  }
  try {
    const data = await http('/teams/members')
    let items = data.items || []
    if (userRole.value === 'team_admin' && currentTeam.value) {
      items = items.filter(m => m.team === currentTeam.value)
    }
    teamMembers.value = items.map(m => ({
      user: m.display_name || m.username,
      username: m.username,
      displayName: m.display_name,
      team: m.team,
      role: m.role,
    }))
  } catch (e) {
    console.error('加载成员列表失败:', e)
    teamMembers.value = []
  }
}

async function loadAllTeams() {
  if (userRole.value !== 'admin') return
  try {
    const data = await http('/teams?page_size=100')
    allTeams.value = data.items || []
  } catch (e) {
    console.error('加载团队列表失败:', e)
  }
}

// ───── 日导航 ─────
const dayOffset = ref(0)

function getDayStart(offset = 0) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() + offset)
  return now
}

const currentDay = computed(() => getDayStart(dayOffset.value))

const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const dayLabel = computed(() => {
  const d = currentDay.value
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdayLabels[d.getDay()]}`
})

const weekdayLabel = computed(() => weekdayLabels[currentDay.value.getDay()])

const dayNumber = computed(() => currentDay.value.getDate())

const isToday = computed(() => dayOffset.value === 0)

function shiftDay(n) {
  dayOffset.value += n
}

function goToday() {
  dayOffset.value = 0
}

// ───── 条目计算 ─────
function localDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getEndTime(e) {
  const et = e.fields['end_time']
  if (!et || et === 'null' || et === 'undefined') return new Date()
  return new Date(et)
}

function entryDurationMin(e) {
  const s = new Date(e.fields['start_time'])
  const en = getEndTime(e)
  return Math.max(0, (en - s) / 60000)
}

function entryColor(e) {
  const cat = e.fields['category'] || '其他'
  return allCategories.value.find(c => c.name === cat)?.color || '#6b7280'
}

function entryTimeRange(e) {
  const s = new Date(e.fields['start_time'])
  const en = getEndTime(e)
  return `${fmtTime(s)} - ${fmtTime(en)}`
}

function fmtTime(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function fmtHM(min) {
  min = Math.round(min)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// 当天条目列表
const dayEntriesList = computed(() => {
  const dateStr = localDateStr(currentDay.value)
  return entries.value.filter(e => {
    const start = new Date(e.fields['start_time'])
    return localDateStr(start) === dateStr
  })
})

const dayTotalMin = computed(() => {
  return dayEntriesList.value.reduce((sum, e) => sum + entryDurationMin(e), 0)
})

function entryStyle(e) {
  const s = new Date(e.fields['start_time'])
  const en = getEndTime(e)
  let startMin = s.getHours() * 60 + s.getMinutes()
  let endMin = en.getHours() * 60 + en.getMinutes()
  if (localDateStr(en) !== localDateStr(s)) {
    endMin = 24 * 60
  }
  const durMin = Math.max(0, endMin - startMin)
  const top = (startMin / 60) * hourPx.value
  const height = Math.max(20, (durMin / 60) * hourPx.value)
  const color = entryColor(e)
  return {
    top: top + 'px',
    height: height + 'px',
    background: color + '22',
    borderLeft: '3px solid ' + color,
  }
}

// 判断条目是否太短放不下文字 (高度 < 28px)
function isShortEntry(e) {
  const s = new Date(e.fields['start_time'])
  const en = getEndTime(e)
  let endMin = en.getHours() * 60 + en.getMinutes()
  if (localDateStr(en) !== localDateStr(s)) endMin = 24 * 60
  const startMin = s.getHours() * 60 + s.getMinutes()
  const durMin = Math.max(0, endMin - startMin)
  const height = Math.max(20, (durMin / 60) * hourPx.value)
  return height < 28
}

// ───── 当前时间红线 ─────
const nowOffsetPx = ref(0)
let nowInterval = null
const calRef = ref(null)
function updateNowLine() {
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const cappedMin = Math.min(nowMin, 24 * 60 - 1)
  nowOffsetPx.value = (cappedMin / 60) * hourPx.value
}

function scrollToNow() {
  if (!calRef.value) return
  const container = calRef.value
  const targetScroll = nowOffsetPx.value - container.clientHeight / 2 + 73
  container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' })
}

watch(hourPx, updateNowLine)

// ───── 加载数据 ─────
let allEntriesCache = []

function filterEntries() {
  const scope = viewScope.value
  const items = allEntriesCache
  if (scope === 'self') {
    const name = displayName.value || userName.value
    entries.value = name ? items.filter(e => e.fields.user === name) : []
  } else if (scope === 'member') {
    const name = selectedUser.value || userName.value
    entries.value = name ? items.filter(e => e.fields.user === name) : []
  } else if (scope === 'team') {
    const teamFilter = selectedTeam.value || currentTeam.value
    if (teamFilter) {
      const usersInTeam = new Set(teamMembers.value.filter(m => m.team === teamFilter).map(m => m.user))
      entries.value = items.filter(e => usersInTeam.has(e.fields.user))
    } else {
      entries.value = items
    }
  } else if (scope === 'all' && selectedTeam.value) {
    const usersInTeam = new Set(teamMembers.value.filter(m => m.team === selectedTeam.value).map(m => m.user))
    entries.value = items.filter(e => usersInTeam.has(e.fields.user))
  } else {
    entries.value = items
  }
}

async function loadEntries() {
  const cached = localStorage.getItem('tt_entries_cache')
  if (cached) {
    try {
      allEntriesCache = JSON.parse(cached)
      filterEntries()
    } catch (e) {}
  }
  try {
    const data = await http('/entries?page_size=500')
    allEntriesCache = data.items || []
    localStorage.setItem('tt_entries_cache', JSON.stringify(allEntriesCache))
    // 先按当前 scope 过滤渲染 (不等 Promise.all)
    filterEntries()
    await Promise.all([
      loadTeamMembers(),
      loadAllTeams(),
      loadTeamCategories(),
      loadAllCategories(),
    ])
    // 成员列表刷新后重新过滤 (team 模式按 teamMembers 过滤)
    filterEntries()
  } catch (e) {
    console.error('加载失败:', e)
  }
}

// ───── 国家检索 ─────
const allCountries = ref([])
const countrySearch = ref('')
const showCountryDropdown = ref(false)

const filteredCountries = computed(() => {
  const q = countrySearch.value.trim().toLowerCase()
  if (!q) return allCountries.value.slice(0, 50)
  return allCountries.value.filter(c => c.name.toLowerCase().includes(q)).slice(0, 50)
})

function pickCountry(name) {
  timerForm.value.country = name
  showCountryDropdown.value = false
  countrySearch.value = ''
}

function hideCountryDropdownLater() {
  setTimeout(() => { showCountryDropdown.value = false }, 150)
}

// 编辑弹窗的国家下拉 (独立状态, 避免和开始计时弹窗冲突)
const showEditCountryDropdown = ref(false)
const filteredEditCountries = computed(() => {
  const q = (editForm.value.country || '').trim().toLowerCase()
  if (!q) return allCountries.value
  return allCountries.value.filter(c =>
    c.name.toLowerCase().includes(q) || (c.code && c.code.toLowerCase().includes(q))
  )
})
function pickEditCountry(name) {
  editForm.value.country = name
  showEditCountryDropdown.value = false
}
function hideEditCountryDropdownLater() {
  setTimeout(() => { showEditCountryDropdown.value = false }, 150)
}

async function loadAllCountries() {
  try {
    const data = await http('/countries?page_size=300')
    allCountries.value = data.items || []
  } catch (e) {
    console.error('加载国家失败:', e)
  }
}

// ───── 开始计时弹窗 ─────
const showStartModal = ref(false)
const timerForm = ref({
  description: '',
  category: '其他',
  country: '中国',
  notes: '',
})

function openStartTimer() {
  timerForm.value = {
    description: '',
    category: localStorage.getItem('tt_last_category') || teamCategories.value[0]?.name || '其他',
    country: localStorage.getItem('tt_last_country') === '国内' ? '中国' : (localStorage.getItem('tt_last_country') || '中国'),
    notes: '',
  }
  showStartModal.value = true
}

function startTimer() {
  localStorage.setItem('tt_last_category', timerForm.value.category)
  localStorage.setItem('tt_last_country', timerForm.value.country)

  const cat = timerForm.value.category || '其他'
  const color = teamCategories.value.find(c => c.name === cat)?.color || '#6366f1'

  startActiveTimer({
    description: timerForm.value.description,
    category: cat,
    color,
    country: timerForm.value.country,
    user: displayName.value || userName.value,
    notes: timerForm.value.notes,
  })
  showStartModal.value = false
}

// ───── 编辑条目弹窗 ─────
const showEditModal = ref(false)
const editForm = ref({
  record_id: '',
  description: '',
  category: '其他',
  startTime: '',
  endTime: '',
  country: '',
  notes: '',
})

async function openEdit(e) {
  const s = new Date(e.fields['start_time'])
  const en = getEndTime(e)
  editForm.value = {
    record_id: e.record_id,
    description: e.fields['description'] || '',
    category: e.fields['category'] || '其他',
    startTime: toLocalDatetime(s),
    endTime: toLocalDatetime(en),
    country: e.fields['country'] || '',
    notes: e.fields['notes'] || '',
  }
  showEditModal.value = true
  loadCategoriesForUser(e.fields['user'])
}

function toLocalDatetime(d) {
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}

function fromLocalDatetime(s) {
  return new Date(s).toISOString()
}

async function saveEdit() {
  const rid = editForm.value.record_id
  const oldEntry = entries.value.find(e => e.record_id === rid)
  const newFields = {
    'description': editForm.value.description,
    'category': editForm.value.category,
    'start_time': fromLocalDatetime(editForm.value.startTime),
    'end_time': fromLocalDatetime(editForm.value.endTime),
    'country': editForm.value.country,
    'notes': editForm.value.notes,
  }
  if (oldEntry) {
    entries.value = entries.value.map(e =>
      e.record_id === rid ? { ...e, fields: { ...e.fields, ...newFields } } : e
    )
  }
  showEditModal.value = false
  try {
    await http(`/entries/${rid}`, { method: 'PUT', body: { fields: newFields } })
  } catch (e) {
    console.error('保存失败:', e)
    if (oldEntry) {
      entries.value = entries.value.map(x =>
        x.record_id === rid ? oldEntry : x
      )
    }
    alert('保存失败, 请重试')
  }
}

async function deleteEntry() {
  if (!confirm('确定删除这条记录？')) return
  const rid = editForm.value.record_id
  const oldIdx = entries.value.findIndex(e => e.record_id === rid)
  const oldEntry = oldIdx >= 0 ? entries.value[oldIdx] : null
  if (oldIdx >= 0) {
    entries.value.splice(oldIdx, 1)
  }
  showEditModal.value = false
  try {
    await http(`/entries/${rid}`, { method: 'DELETE' })
  } catch (e) {
    console.error('删除失败:', e)
    if (oldEntry) {
      entries.value.splice(oldIdx, 0, oldEntry)
    }
    alert('删除失败, 请重试')
  }
}

// ───── 生命周期 ─────
onMounted(() => {
  updateNowLine()
  nowInterval = setInterval(updateNowLine, 60000)
  if (userName.value) loadEntries()
  loadAllCountries()
  loadTeamCategories()
  loadAllCategories()
  // 进入/刷新网页时自动滚动到红线中间
  nextTick(() => setTimeout(scrollToNow, 100))
})

onUnmounted(() => {
  if (nowInterval) clearInterval(nowInterval)
})
</script>

<style scoped>
.day-view {
  max-width: 1400px;
  margin: 0 auto;
}

/* 固定顶部工具栏 (暗色科技感, 与 WeekView 一致) */
.day-toolbar {
  position: fixed;
  top: 48px;
  left: var(--sidebar-width);
  right: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 24px;
  background: var(--surface);
  box-shadow: 0 1px 0 var(--border), 0 4px 12px rgba(0, 0, 0, 0.3);
  height: 48px;
  box-sizing: border-box;
  backdrop-filter: blur(8px);
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 视图切换标签 */
.view-tabs {
  display: flex;
  gap: 4px;
  padding: 2px;
  background: var(--bg);
  border-radius: 8px;
}
.view-tab {
  padding: 4px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.15s;
}
.view-tab:hover {
  color: var(--text);
}
.view-tab.active {
  background: var(--surface);
  color: var(--primary);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 工具栏中间的计时器 */
.toolbar-timer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  border-radius: 12px;
  background: var(--surface-light);
  border: 1px solid var(--border-light);
  font-size: 14px;
}
.toolbar-timer.is-running { border: 1px solid transparent; }
.timer-pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  animation: pulse-dot 1.5s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}
.timer-desc {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.timer-cat {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--surface-hover);
}
.timer-elapsed {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
  text-shadow: 0 0 8px var(--primary-glow);
}
.timer-idle { font-size: 16px; opacity: 0.5; }
.timer-idle-text { color: var(--text-secondary); font-weight: 500; }
.timer-start {
  padding: 5px 14px;
  background: var(--primary);
  color: var(--bg);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 0 12px var(--primary-glow);
}
.timer-start:hover { background: var(--primary); opacity: 0.85; }
.timer-stop {
  padding: 5px 12px;
  background: var(--danger);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.timer-stop:hover { opacity: 0.85; }

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 查看切换 */
.view-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.view-switch label { color: var(--text-secondary); }
.view-switch select {
  padding: 4px 32px 4px 10px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  font-size: 14px;
  background-color: var(--bg);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M5 8l5 5 5-5' stroke='%2300d4ff' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  color: var(--text);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
}
.member-search-wrap { position: relative; }
.member-search-input {
  width: 140px;
  padding: 4px 8px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg);
  color: var(--text);
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
  max-height: 300px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  box-shadow: var(--shadow);
  z-index: 200;
  margin-top: 2px;
}
.member-option {
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.member-option:hover { background: var(--surface-hover); color: var(--primary); }
.member-option.active { background: var(--primary); color: var(--bg); }
.member-sub { font-size: 11px; color: var(--text-secondary); }
.member-option.active .member-sub { color: var(--bg); }
.member-empty { padding: 8px 10px; font-size: 12px; color: var(--text-secondary); text-align: center; }

/* 显示姓名开关 */
.show-name-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  color: var(--text-secondary);
  padding-right: 8px;
  border-right: 1px solid var(--border);
  margin-right: 4px;
}
.show-name-toggle input { cursor: pointer; }

.zoom-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
.zoom-control input[type="range"] { width: 100px; }
.zoom-value { min-width: 60px; }

/* ───── 日视图主体 ───── */
.day-cal {
  display: grid;
  grid-template-columns: 60px 1fr;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--surface);
  align-items: start;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
}

.time-col {
  border-right: 1px solid var(--border);
  background: var(--bg);
}

.time-head {
  height: 73px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
}

.time-cell {
  padding: 2px 6px 0 0;
  font-size: 10px;
  color: var(--text-secondary);
  text-align: right;
  border-top: 1px solid var(--border);
  box-sizing: border-box;
}

.day-main {
  display: flex;
  flex-direction: column;
}

.day-head {
  padding: 8px 4px;
  text-align: center;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  height: 73px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: sticky;
  top: 0;
  z-index: 10;
}

.day-head.today { background: rgba(0, 212, 255, 0.08); }

.dow { font-size: 12px; color: var(--text-secondary); }
.dnum {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text);
}
.dtotal {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.dtotal.has {
  color: var(--primary);
  font-weight: 600;
  text-shadow: 0 0 8px var(--primary-glow);
}

.day-body {
  position: relative;
}

.now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--danger);
  z-index: 10;
  pointer-events: none;
  box-shadow: 0 0 8px rgba(255, 51, 102, 0.5);
}

.now-line::before {
  content: '';
  position: absolute;
  left: -4px;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 8px rgba(255, 51, 102, 0.5);
}

/* 条目卡片 - 日视图更宽更详细 */
.entry {
  position: absolute;
  left: 4px;
  right: 4px;
  border-radius: 6px;
  padding: 6px 10px;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  transition: transform 0.1s, box-shadow 0.15s, border-color 0.15s;
}
.entry:hover {
  transform: translateX(2px);
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
}
.entry.is-running {
  border: 1px solid transparent;
}

/* 短时长条目: 显示为分类颜色的细线, hover 时展开为放得下字高的彩色块 */
.entry.is-short {
  height: 3px !important;
  border-left: none;
  border-radius: 2px;
  overflow: visible;
  cursor: pointer;
}
.entry.is-short .e-bar,
.entry.is-short .e-content,
.entry.is-short .e-title,
.entry.is-short .e-meta {
  display: none;
}
.entry.is-short:hover {
  height: 45px !important;
  border-radius: 4px;
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
  z-index: 20;
}
.entry.is-short:hover .e-bar {
  display: block;
}
.entry.is-short:hover .e-content {
  display: flex;
}
.entry.is-short:hover .e-title {
  display: flex;
}
.entry.is-short:hover .e-meta {
  display: flex !important;
}
.entry.is-short:hover .e-cat,
.entry.is-short:hover .e-dur {
  display: none !important;
}

.e-bar {
  width: 3px;
  align-self: stretch;
  border-radius: 2px;
  flex-shrink: 0;
}
.e-content {
  flex: 1;
  min-width: 0;
}
.e-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.e-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-secondary);
}
.e-cat { font-weight: 500; }
.e-time { font-variant-numeric: tabular-nums; }
.e-dur { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text); }

.running-tag {
  display: inline-block;
  padding: 1px 6px;
  background: var(--success);
  color: var(--bg);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  margin-left: 6px;
  animation: pulse-tag 1.5s ease-in-out infinite;
}
@keyframes pulse-tag {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.day-sum {
  text-align: right;
  padding: 16px;
  font-size: 14px;
  color: var(--text-secondary);
}
.day-sum strong {
  color: var(--primary);
  font-size: 18px;
  font-weight: 700;
  text-shadow: 0 0 8px var(--primary-glow);
}

/* ───── 弹窗样式 (复用全局) ───── */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-card {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 90%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 20px var(--primary-glow);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.modal-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  text-shadow: 0 0 8px var(--primary-glow);
}
.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
}
.modal-close:hover { color: var(--text); }
.form-field { margin-bottom: 12px; }
.form-field label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.form-field input,
.form-field select,
.form-field textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  font-size: 14px;
  background: var(--bg);
  color: var(--text);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.form-field input:focus,
.form-field select:focus,
.form-field textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}
.form-field textarea { resize: vertical; }
.form-row { display: flex; gap: 12px; }
.form-row .form-field { flex: 1; }
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s, box-shadow 0.15s;
}
.btn-primary {
  background: var(--primary);
  color: var(--bg);
  box-shadow: 0 0 12px var(--primary-glow);
}
.btn-primary:hover { opacity: 0.85; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
.btn-secondary {
  background: var(--surface-hover);
  color: var(--text);
  border: 1px solid var(--border-light);
}
.btn-secondary:hover { background: var(--surface-hover); color: var(--primary); border-color: var(--primary); }
.btn-danger { background: var(--danger); color: white; }
.btn-danger:hover { opacity: 0.85; }
.required { color: var(--danger); }

/* 国家检索 */
.country-search-wrap { position: relative; }
.country-search-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg);
  color: var(--text);
}
.country-search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}
.country-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 400px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  box-shadow: var(--shadow);
  z-index: 200;
  margin-top: 2px;
}
.country-option {
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text);
}
.country-option:hover { background: var(--surface-hover); color: var(--primary); }
.country-option.active { background: var(--primary); color: var(--bg); }
.country-code { font-size: 11px; color: var(--text-secondary); }
.country-option.active .country-code { color: var(--bg); }
.country-empty { padding: 8px 10px; font-size: 12px; color: var(--text-secondary); text-align: center; }
</style>
