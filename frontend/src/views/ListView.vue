<template>
  <div class="list-view">
    <!-- 固定顶部栏: 周导航 + 查看切换 -->
    <div class="list-toolbar">
      <div class="toolbar-left">
        <button class="nav-arrow" @click="shiftWeek(-1)">‹</button>
        <span class="week-range">{{ rangeText }}</span>
        <button class="nav-arrow" @click="shiftWeek(1)">›</button>
        <button class="today-btn" @click="goToday">本周</button>
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
            <input
              v-model="memberSearch"
              class="member-search-input"
              placeholder="检索成员..."
              @focus="showMemberDropdown = true"
              @blur="hideMemberDropdownLater"
            />
            <div v-if="showMemberDropdown" class="member-dropdown">
              <div
                class="member-option"
                :class="{ active: selectedUser === '' }"
                @mousedown="pickMember('')"
              >
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
          <select v-if="viewScope === 'all' && userRole === 'admin'" v-model="selectedTeam" @change="loadEntries">
            <option value="">(全部团队)</option>
            <option v-for="t in allTeams" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
        <label class="show-name-toggle">
          <input type="checkbox" v-model="showUserName" />
          <span>显示姓名</span>
        </label>
      </div>
    </div>

    <!-- 列表: 按日期分组 -->
    <div class="list-body">
      <div v-if="groupedEntries.length === 0" class="list-empty">
        本周暂无工时记录
      </div>
      <div v-for="group in groupedEntries" :key="group.dateStr" class="day-group">
        <div class="day-group-header">
          <span class="day-date">{{ group.dateLabel }}</span>
          <span class="day-weekday">{{ group.weekday }}</span>
          <span class="day-count">{{ group.entries.length }} 条</span>
          <span class="day-total">{{ fmtHM(group.totalMin) }}</span>
        </div>
        <div class="day-entries">
          <div
            v-for="e in group.entries"
            :key="e.record_id"
            class="list-entry"
            :class="{ 'is-running': !e.fields['end_time'] }"
            @click="openEdit(e)"
          >
            <div class="entry-cat-dot" :style="{ background: entryColor(e) }"></div>
            <div class="entry-main">
              <div class="entry-desc">
                <template v-if="showUserName">{{ e.fields['user'] || '?' }}：</template>{{ e.fields['description'] || '(无描述)' }}
                <span v-if="!e.fields['end_time']" class="running-tag">进行中</span>
              </div>
              <div class="entry-meta">
                <span class="entry-cat" :style="{ color: entryColor(e) }">{{ e.fields['category'] || '其他' }}</span>
                <span class="entry-time">{{ entryTimeRange(e) }}</span>
              </div>
            </div>
            <div class="entry-duration">{{ fmtHM(entryDurationMin(e)) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 本周合计 -->
    <div class="week-sum">
      本周合计：<strong>{{ fmtHM(weekTotalMin) }}</strong>
    </div>

    <!-- 开始计时弹窗 -->
    <div v-if="showStartModal" class="modal-mask" @click.self="showStartModal = false">
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">开始计时</div>
          <button class="modal-close" @click="showStartModal = false">×</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label>任务名 <span class="required">*</span></label>
            <input v-model="timerForm.description" placeholder="你在做什么？" />
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
              <input
                v-model="countrySearch"
                class="country-search-input"
                placeholder="检索国家..."
                @focus="showCountryDropdown = true"
                @blur="hideCountryDropdownLater"
              />
              <div v-if="showCountryDropdown" class="country-dropdown">
                <div
                  v-for="c in filteredCountries"
                  :key="c.record_id"
                  class="country-option"
                  :class="{ active: timerForm.country === c.name }"
                  @mousedown="pickCountry(c.name)"
                >
                  <span>{{ c.name }}</span>
                  <span class="country-code">{{ c.code }}</span>
                </div>
                <div v-if="filteredCountries.length === 0" class="country-empty">无匹配国家</div>
              </div>
            </div>
          </div>
          <div class="form-field">
            <label>备注</label>
            <textarea v-model="timerForm.notes" rows="2"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showStartModal = false">取消</button>
          <button class="btn btn-primary" @click="startTimer">开始计时</button>
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
        <div class="modal-body">
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
const allCategories = ref([{ name: '其他', color: '#6b7280' }])

// ───── 数据 ─────
const entries = ref([])
// 显示姓名开关: 全局共享 (从 App.vue inject)
const showUserName = inject('showUserName')

// ───── 权限分级 (同 WeekView) ─────
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

// ───── 周导航 ─────
const weekOffset = ref(0)

function getWeekStart(offset = 0) {
  const now = new Date()
  const day = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return monday
}

const weekStart = computed(() => getWeekStart(weekOffset.value))

const rangeText = computed(() => {
  const s = weekStart.value
  const e = new Date(s)
  e.setDate(s.getDate() + 6)
  return `${s.getMonth() + 1}月${s.getDate()}-${e.getMonth() + 1}月${e.getDate()}日`
})

function shiftWeek(n) {
  weekOffset.value += n
  loadEntries()
}

function goToday() {
  weekOffset.value = 0
  loadEntries()
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
  return (en - s) / 60000
}

function entryColor(e) {
  const cat = e.fields['category'] || '其他'
  return teamCategories.value.find(c => c.name === cat)?.color
    || allCategories.value.find(c => c.name === cat)?.color
    || '#6b7280'
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

// ───── 按日期分组 (List View 核心) ─────
const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 预分组: 按 localDateStr(start_time) 建 Map, 避免每天 filter 全部 entries
const entriesByDate = computed(() => {
  const map = new Map()
  for (const e of entries.value) {
    const start = new Date(e.fields['start_time'])
    const key = localDateStr(start)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(e)
  }
  return map
})

const groupedEntries = computed(() => {
  const groups = []
  for (let d = 0; d < 7; d++) {
    const date = new Date(weekStart.value)
    date.setDate(date.getDate() + d)
    const dateStr = localDateStr(date)
    const dayEntries = entriesByDate.value.get(dateStr)
    if (!dayEntries || dayEntries.length === 0) continue
    const totalMin = dayEntries.reduce((sum, e) => sum + entryDurationMin(e), 0)
    groups.push({
      dateStr,
      dateLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
      weekday: weekdayLabels[date.getDay()],
      entries: dayEntries,
      totalMin,
    })
  }
  return groups
})

const weekTotalMin = computed(() => {
  let total = 0
  for (const g of groupedEntries.value) total += g.totalMin
  return total
})

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
      const usersInTeam = new Set(
        teamMembers.value.filter(m => m.team === teamFilter).map(m => m.user)
      )
      entries.value = items.filter(e => usersInTeam.has(e.fields.user))
    } else {
      entries.value = items
    }
  } else if (scope === 'all' && selectedTeam.value) {
    const usersInTeam = new Set(
      teamMembers.value.filter(m => m.team === selectedTeam.value).map(m => m.user)
    )
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
  } catch (e) {
    console.error('加载条目失败:', e)
  }
  // 并行加载成员/团队/分类 (失败不影响条目显示)
  try {
    await Promise.all([
      loadTeamMembers(),
      loadAllTeams(),
      loadTeamCategories(),
      loadAllCategories(),
    ])
    // 成员列表刷新后重新过滤 (team 模式按 teamMembers 过滤)
    filterEntries()
  } catch (e) {
    console.error('加载分类/成员失败:', e)
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

// ───── 国家检索 (同 WeekView) ─────
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
  await loadCategoriesForUser(e.fields['user'])
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

// ───── 计时事件监听 ─────
function onTimerStopped() { loadEntries() }
function onTimerStarted(e) {
  const d = e.detail || {}
  entries.value.push({
    record_id: d.record_id,
    fields: {
      description: d.description,
      category: d.category,
      user: d.user,
      country: d.country,
      start_time: d.start_time,
      end_time: d.end_time,
    },
  })
}
function onTimerRecordReady() { loadEntries() }
function onTimerStartFailed() { loadEntries() }

onMounted(() => {
  // loadEntries 内部 Promise.all 已加载成员/团队/分类, 不重复调
  if (userName.value) loadEntries()
  loadAllCountries()
  window.addEventListener('timer-stopped', onTimerStopped)
  window.addEventListener('timer-started', onTimerStarted)
  window.addEventListener('timer-record-ready', onTimerRecordReady)
  window.addEventListener('timer-start-failed', onTimerStartFailed)
})

onUnmounted(() => {
  window.removeEventListener('timer-stopped', onTimerStopped)
  window.removeEventListener('timer-started', onTimerStarted)
  window.removeEventListener('timer-record-ready', onTimerRecordReady)
  window.removeEventListener('timer-start-failed', onTimerStartFailed)
})
</script>

<style scoped>
.list-view {
  max-width: 1400px;
  margin: 0 auto;
}

/* 固定顶部工具栏 (顶满宽度, 不挡侧边栏) */
.list-toolbar {
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
  background: #f8f9fa;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  height: 48px;
  box-sizing: border-box;
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
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-arrow {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px 8px;
}
.nav-arrow:hover { color: var(--primary); }

.week-range { font-weight: 600; min-width: 180px; }

.today-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
}

/* 工具栏中间的计时器 */
.toolbar-timer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid var(--border);
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
  background: rgba(255, 255, 255, 0.7);
}
.timer-elapsed {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
}
.timer-idle { font-size: 16px; opacity: 0.5; }
.timer-idle-text { color: var(--text-secondary); font-weight: 500; }
.timer-start {
  padding: 5px 14px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.timer-start:hover { background: var(--primary-dark); }
.timer-stop {
  padding: 5px 12px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.timer-stop:hover { background: #dc2626; }

/* 查看切换 */
.view-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.view-switch label { color: var(--text-secondary); }
.view-switch select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--surface);
}
.member-search-wrap { position: relative; }
.member-search-input {
  width: 140px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
.member-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 300px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
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
.member-option:hover { background: #f3f4f6; }
.member-option.active { background: #6366f1; color: #fff; }
.member-sub { font-size: 11px; color: var(--text-secondary); }
.member-option.active .member-sub { color: #e0e7ff; }
.member-empty { padding: 8px 10px; font-size: 12px; color: var(--text-secondary); text-align: center; }

/* 显示姓名开关 */
.show-name-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  padding-right: 8px;
  border-right: 1px solid var(--border);
  margin-right: 4px;
}
.show-name-toggle input { cursor: pointer; }

/* ───── 列表主体 ───── */
.list-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.list-empty {
  padding: 60px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
}

.day-group {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.day-group-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
.day-date { font-weight: 600; }
.day-weekday { color: var(--text-secondary); font-size: 13px; }
.day-count { color: var(--text-secondary); font-size: 12px; margin-left: auto; }
.day-total { font-weight: 600; color: var(--primary); }

.day-entries {
  display: flex;
  flex-direction: column;
}

.list-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s;
}
.list-entry:last-child { border-bottom: none; }
.list-entry:hover { background: var(--bg); }
.list-entry.is-running { background: rgba(99, 102, 241, 0.05); }

.entry-cat-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.entry-main {
  flex: 1;
  min-width: 0;
}
.entry-desc {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.entry-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.entry-cat { font-weight: 500; }
.entry-time { font-variant-numeric: tabular-nums; }

.entry-duration {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  flex-shrink: 0;
}

.running-tag {
  display: inline-block;
  padding: 1px 6px;
  background: #10b981;
  color: white;
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

.week-sum {
  text-align: right;
  padding: 16px;
  font-size: 14px;
  color: var(--text-secondary);
}
.week-sum strong {
  color: var(--primary);
  font-size: 18px;
  font-weight: 700;
}

/* ───── 国家检索 ───── */
.country-search-wrap { position: relative; }
.country-search-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
.country-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 400px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
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
}
.country-option:hover { background: #f3f4f6; }
.country-option.active { background: #6366f1; color: #fff; }
.country-code { font-size: 11px; color: var(--text-secondary); }
.country-option.active .country-code { color: #e0e7ff; }
.country-empty { padding: 8px 10px; font-size: 12px; color: var(--text-secondary); text-align: center; }
</style>
