<template>
  <div class="week-view">
    <!-- 固定顶部栏: 周导航 + 查看切换 + 密度 -->
    <div class="week-toolbar">
      <div class="toolbar-left">
        <button class="nav-arrow" @click="shiftWeek(-1)">‹</button>
        <span class="week-range">{{ rangeText }}</span>
        <button class="nav-arrow" @click="shiftWeek(1)">›</button>
        <button class="today-btn" @click="goToday">本周</button>
      </div>
      <!-- 计时器 (集成在工具栏中间, 管理员不显示) -->
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
          <select v-if="viewScope === 'all' && userRole === 'admin'" v-model="selectedTeam" @change="filterEntries">
            <option value="">(全部团队)</option>
            <option v-for="t in allTeams" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
        <div class="zoom-control">
          <label class="show-name-toggle">
            <input type="checkbox" v-model="showUserName" />
            <span>显示姓名</span>
          </label>
          <span class="zoom-label">密度</span>
          <input type="range" min="32" max="240" step="16" :value="hourPx" @input="hourPx = Number($event.target.value)" />
          <span class="zoom-value">{{ hourPx }}px/h</span>
        </div>
      </div>
    </div>

    <!-- 日历容器 (自己滚动) -->
    <div class="cal" ref="calRef">
      <div class="time-col">
        <div class="time-head"></div>
        <div class="time-cell" v-for="h in 24" :key="h - 1" :style="{ height: hourPx + 'px' }">
          {{ String(h - 1).padStart(2, '0') }}:00
        </div>
      </div>
      <div class="day-col" v-for="d in 7" :key="d">
        <div class="day-head" :class="{ today: isToday(d) }">
          <div class="dow">{{ weekLabels[d - 1] }}</div>
          <div class="dnum">{{ dayNumber(d) }}</div>
          <div class="dtotal" :class="{ has: dayTotalMin(d) > 0 }">
            {{ dayTotalMin(d) > 0 ? fmtHM(dayTotalMin(d)) : '—' }}
          </div>
        </div>
        <div class="day-body" :style="{ height: (24 * hourPx) + 'px' }">
          <div v-if="isToday(d)" class="now-line" :style="{ top: nowOffsetPx + 'px' }"></div>
          <div
            v-for="e in dayEntries(d)"
            :key="e.record_id"
            class="entry"
            :class="{ 'is-running': !e.fields['end_time'], 'is-short': isShortEntry(e) }"
            :style="entryStyle(e, d)"
            @click.stop="openEdit(e)"
          >
            <div class="e-title">
              <template v-if="showUserName">{{ e.fields['user'] || '?' }}：</template>{{ e.fields['description'] || '(无描述)' }}
              <span v-if="!e.fields['end_time']" class="running-tag">进行中</span>
            </div>
            <div class="e-time">{{ entryTimeRange(e) }}</div>
            <div v-if="!isShortEntry(e)" class="e-dur">{{ fmtHM(entryDurationMin(e)) }}</div>
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

        <div class="form-row">
          <div class="form-field">
            <label>时区</label>
            <select v-model="timerForm.timezone">
              <option v-for="tz in timezones" :key="tz.value" :value="tz.value">{{ tz.label }}</option>
            </select>
          </div>
          <div class="form-field">
            <label>国家</label>
            <div class="country-search-wrap">
              <input
                v-model="timerForm.country"
                placeholder="检索国家..."
                class="country-search-input"
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
                <div v-if="filteredCountries.length === 0" class="country-empty">无匹配</div>
              </div>
            </div>
          </div>
        </div>

        <div class="form-field">
          <label>姓名 <span class="required">*</span></label>
          <input v-model="timerForm.displayName" />
        </div>

        <div class="form-field">
          <label>备注</label>
          <textarea v-model="timerForm.notes" placeholder="可选"></textarea>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showStartModal = false">取消</button>
          <button class="btn btn-primary" @click="startTimer" :disabled="!timerForm.description || !timerForm.category">
            确认开始
          </button>
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
          <textarea v-model="editForm.notes"></textarea>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="continueEntry">▶ 继续</button>
          <button class="btn btn-danger" @click="deleteEntry">删除</button>
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
const isAdmin = inject('isAdmin')
const categories = inject('categories')
const countries = inject('countries')
const timezones = inject('timezones')
const activeTimer = inject('activeTimer')
const startActiveTimer = inject('startActiveTimer')
const stopActiveTimer = inject('stopActiveTimer')
const currentPage = inject('currentPage')
const setPage = inject('setPage')

// ───── 团队分类 (按 currentTeam 从后端加载) ─────
const currentTeam = inject('userTeam')
const teamCategories = ref([{ name: '其他', color: '#6b7280' }])
// allCategories: 所有团队分类合并, 用于管理员看全部时 entryStyle 查颜色
// 用 localStorage 缓存, 打开网站立即显示彩色任务块
const allCategories = ref(
  (() => {
    try {
      const cached = localStorage.getItem('tt_all_categories')
      if (cached) return JSON.parse(cached)
    } catch (e) {}
    return [{ name: '其他', color: '#6b7280' }]
  })()
)

async function loadAllCategories() {
  try {
    const res = await http('/categories?page_size=500')
    let items = res.items || []
    // 去重: 同名分类保留第一个
    const seen = new Map()
    for (const c of items) {
      if (!seen.has(c.name)) seen.set(c.name, c)
    }
    items = Array.from(seen.values())
    // 确保"其他"存在
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
  // 管理员加载所有团队的分类合并 (去重, 同名分类保留第一个颜色)
  if (userRole.value === 'admin') {
    try {
      // 拉所有分类 (不传 team 就返回全部)
      const res = await http('/categories?page_size=500')
      let items = res.items || []
      // 去重: 同名分类保留第一个
      const seen = new Map()
      for (const c of items) {
        if (!seen.has(c.name)) seen.set(c.name, c)
      }
      items = Array.from(seen.values())
      // 确保"其他"存在
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
    // 确保"其他"存在
    if (!items.find(c => c.name === '其他')) {
      items.unshift({ name: '其他', color: '#6b7280' })
    }
    teamCategories.value = items
  } catch (e) {
    console.error('加载团队分类失败:', e)
    teamCategories.value = [{ name: '其他', color: '#6b7280' }]
  }
}

// 按条目成员的团队加载分类 (管理员编辑条目时用)
async function loadCategoriesForUser(user) {
  if (!user) return
  // 从 teamMembers 找到该用户所属团队
  const member = teamMembers.value.find(m => m.user === user || m.displayName === user)
  const team = member?.team
  // !team: 找不到成员团队, 回退到加载自己团队分类 (和 DayView/ListView 一致)
  if (!team) {
    await loadTeamCategories()
    return
  }
  // 1. 先用内存 allCategories 按 team 过滤立即显示 (0 网络延迟)
  const localFiltered = allCategories.value.filter(c => c.team === team)
  let items = localFiltered.length > 0 ? localFiltered : [{ name: '其他', color: '#6b7280' }]
  if (!items.find(c => c.name === '其他')) {
    items.unshift({ name: '其他', color: '#6b7280' })
  }
  teamCategories.value = items
  // 2. 后台异步刷新最新分类
  try {
    const res = await http(`/categories?team=${encodeURIComponent(team)}`)
    let fresh = res.items || []
    if (!fresh.find(c => c.name === '其他')) {
      fresh.unshift({ name: '其他', color: '#6b7280' })
    }
    teamCategories.value = fresh
  } catch (e) {
    console.error('按团队加载分类失败:', e)
  }
}

// ───── 国家检索 (从飞书国家表加载 205 个) ─────
const allCountries = ref([]) // [{ record_id, name, code }]
const showCountryDropdown = ref(false)

// timerForm 提前定义, 供 filteredCountries computed 引用
const timerForm = ref({
  description: '',
  category: '其他',
  timezone: 'UTC+8',
  country: '中国',
  displayName: '',
  notes: '',
})

const filteredCountries = computed(() => {
  const q = (timerForm.value.country || '').trim().toLowerCase()
  if (!q) return allCountries.value
  return allCountries.value.filter(c =>
    c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
  )
})

async function loadAllCountries() {
  try {
    const res = await http('/countries')
    let items = res.items || []
    // 1. 台湾/香港/澳门加"中国"前缀
    items = items.map(c => {
      if (c.name === '台湾') return { ...c, name: '中国台湾' }
      if (c.name === '香港') return { ...c, name: '中国香港' }
      if (c.name === '澳门') return { ...c, name: '中国澳门' }
      return c
    })
    // 2. 中国放第一个, 其余按拼音(localeCompare)排序
    const china = items.find(c => c.name === '中国')
    const rest = items.filter(c => c.name !== '中国')
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    allCountries.value = china ? [china, ...rest] : rest
  } catch (e) {
    console.error('加载国家失败:', e)
    allCountries.value = []
  }
}

function pickCountry(name) {
  timerForm.value.country = name
  showCountryDropdown.value = false
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

function hideCountryDropdownLater() {
  setTimeout(() => { showCountryDropdown.value = false }, 200)
}
const timerElapsedText = inject('timerElapsedText')
const pendingStartTimer = inject('pendingStartTimer')

// ───── 数据 ─────
const entries = ref([])
const hourPx = ref(Number(localStorage.getItem('tt_hour_px')) || 80)
// 显示姓名开关: 全局共享 (从 App.vue inject)
const showUserName = inject('showUserName')

// ───── 权限分级 ─────
// viewScope: self(只看自己) | team(本团队总表) | all(全部总表) | member(指定成员个人表)
// 管理员默认 all (全部总表), 其他角色默认 self
const viewScope = ref(localStorage.getItem('tt_view_scope') || (userRole.value === 'admin' ? 'all' : 'self'))
// selectedUser: member 模式下选的具体成员
const selectedUser = ref(localStorage.getItem('tt_selected_user') || '')
// selectedTeam: all 模式下可选具体团队; 空字符串=全部团队
const selectedTeam = ref(localStorage.getItem('tt_selected_team') || '')
// teamMembers: 当前用户能看到的所有成员 [{user, displayName}]
const teamMembers = ref([])
// allTeams: 所有团队列表 (admin 用于 all 模式选团队)
const allTeams = ref([])

// 持久化视图状态, 刷新或切换页面后恢复
watch(hourPx, (v) => localStorage.setItem('tt_hour_px', String(v)))
watch(viewScope, (v) => localStorage.setItem('tt_view_scope', v))
watch(selectedUser, (v) => localStorage.setItem('tt_selected_user', v))
watch(selectedTeam, (v) => localStorage.setItem('tt_selected_team', v))
// member 检索
const memberSearch = ref('')
const showMemberDropdown = ref(false)

// 按检索词过滤的成员列表
const filteredMembers = computed(() => {
  const q = memberSearch.value.trim().toLowerCase()
  if (!q) return teamMembers.value
  return teamMembers.value.filter(u => {
    const name = (u.user || '').toLowerCase()
    const disp = (u.displayName || '').toLowerCase()
    return name.includes(q) || disp.includes(q)
  })
})

// 选成员 + 重新加载
function pickMember(user) {
  selectedUser.value = user
  showMemberDropdown.value = false
  memberSearch.value = ''
  filterEntries()
}

function hideMemberDropdownLater() {
  // 延迟关闭, 让 @mousedown 选项先触发
  setTimeout(() => { showMemberDropdown.value = false }, 150)
}

// 切换 viewScope 时重置下级选择 + 重新加载
function onScopeChange() {
  selectedUser.value = ''
  selectedTeam.value = ''
  filterEntries()
}

// 角色标签
const roleLabel = computed(() => {
  const r = userRole.value
  if (r === 'admin') return '管理员'
  if (r === 'team_admin') return '团队管理员'
  return '团队成员'
})

// 是否能查看他人
const canViewOthers = computed(() => {
  const r = userRole.value
  return r === 'team_admin' || r === 'admin'
})

// 加载能查看的成员列表 (team_admin 看自己团队, admin 看全部)
async function loadTeamMembers() {
  if (!canViewOthers.value) {
    teamMembers.value = []
    return
  }
  try {
    // team_admin: 只看自己团队的成员
    // admin: 看全部成员
    const data = await http('/teams/members')
    let items = data.items || []
    // team_admin 过滤自己团队
    if (userRole.value === 'team_admin' && currentTeam.value) {
      items = items.filter(m => m.team === currentTeam.value)
    }
    teamMembers.value = items.map(m => ({
      // 条目的 user 字段存的是 display_name, 所以这里用 display_name 匹配
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

const weekLabels = ['一', '二', '三', '四', '五', '六', '日']

function dayNumber(d) {
  const date = new Date(weekStart.value)
  date.setDate(date.getDate() + d - 1)
  return date.getDate()
}

function isToday(d) {
  const date = new Date(weekStart.value)
  date.setDate(date.getDate() + d - 1)
  const today = new Date()
  return date.toDateString() === today.toDateString()
}

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
// 按日期预分组, 避免v-for每次重过滤全部entries (性能优化)
// 结构: { '2026-08-25': [entry,...], '2026-08-26': [...] }
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

function dayEntries(d) {
  const date = new Date(weekStart.value)
  date.setDate(date.getDate() + d - 1)
  const dateStr = localDateStr(date)
  return entriesByDate.value.get(dateStr) || []
}

function dayTotalMin(d) {
  return dayTotalMinMap.value.get(d) || 0
}

// 缓存每日总时长, 避免 weekTotalMin 循环里重复 reduce
const dayTotalMinMap = computed(() => {
  const map = new Map()
  for (let d = 1; d <= 7; d++) {
    map.set(d, dayEntries(d).reduce((sum, e) => sum + entryDurationMin(e), 0))
  }
  return map
})

const weekTotalMin = computed(() => {
  let total = 0
  for (const v of dayTotalMinMap.value.values()) total += v
  return total
})

// 正在计时的条目 end_time 为空, 用 Date.now() 代替, 避免 1970
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

// 颜色查找缓存: teamCategories 优先, allCategories 兜底, 合并成 Map 避免 find
const categoryColorMap = computed(() => {
  const map = new Map()
  for (const c of allCategories.value) map.set(c.name, c.color || '#6b7280')
  for (const c of teamCategories.value) map.set(c.name, c.color || '#6b7280')
  return map
})

function entryStyle(e, dayIdx) {
  const s = new Date(e.fields['start_time'])
  const en = getEndTime(e)
  // 跨午夜：条目归到开始日，高度截断到当天 24:00
  let startMin = s.getHours() * 60 + s.getMinutes()
  let endMin = en.getHours() * 60 + en.getMinutes()
  // 如果结束时间在第二天（跨午夜），截断到 24:00
  if (localDateStr(en) !== localDateStr(s)) {
    endMin = 24 * 60
  }
  // dayIdx 是 1-7 的数字，转成当天 Date 对象
  if (dayIdx !== undefined) {
    const dayDate = new Date(weekStart.value)
    dayDate.setDate(dayDate.getDate() + dayIdx - 1)
    if (localDateStr(dayDate) !== localDateStr(s)) {
      return { display: 'none' }
    }
  }
  const durMin = Math.max(0, endMin - startMin)
  const top = (startMin / 60) * hourPx.value
  const height = Math.max(20, (durMin / 60) * hourPx.value)
  const cat = e.fields['category'] || '其他'
  const color = categoryColorMap.value.get(cat) || '#6b7280'
  return {
    top: top + 'px',
    height: height + 'px',
    backgroundColor: color + '22',
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

// ───── 当前时间红线 ─────
// 用 ref + setInterval 直接更新, 避免 nowTick 触发整个周视图重渲染
const nowOffsetPx = ref(0)
let nowInterval = null
const calRef = ref(null)
function updateNowLine() {
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const cappedMin = Math.min(nowMin, 24 * 60 - 1)
  // time-cell 用 box-sizing: border-box, 每格高度精确 = hourPx
  nowOffsetPx.value = (cappedMin / 60) * hourPx.value
}

// 自动滚动让红线定位到视图中间
function scrollToNow() {
  if (!calRef.value) return
  const container = calRef.value
  // 红线在 day-body 里, day-body 在 time-head (73px) 下方
  // 滚动到红线位置 - 容器高度的一半
  const targetScroll = nowOffsetPx.value - container.clientHeight / 2 + 73
  container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' })
}

// 密度变化时重算红线位置
watch(hourPx, updateNowLine)

// ───── 加载数据 ─────
// 全部条目缓存 (内存, 避免切换时重复 http 请求)
let allEntriesCache = []

// 从内存缓存按当前 scope/team/user 过滤, 0 网络延迟
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

// 从后端拉全部条目 (首次加载/周导航时用)
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

// 乐观更新后同步缓存, 避免下次 loadEntries 用旧缓存覆盖
function persistCache() {
  allEntriesCache = [...entries.value]
  localStorage.setItem('tt_entries_cache', JSON.stringify(allEntriesCache))
}

// 加载所有团队 (admin 用于 all 模式选团队)
async function loadAllTeams() {
  if (userRole.value !== 'admin') return
  try {
    const res = await http('/teams')
    allTeams.value = res.items || []
  } catch (e) {
    console.error('加载团队列表失败:', e)
  }
}

// ───── 开始计时 ─────
const showStartModal = ref(false)

function openStartTimer() {
  timerForm.value = {
    description: '',
    category: localStorage.getItem('tt_last_category') || teamCategories.value[0]?.name || '其他',
    timezone: 'UTC+8',
    country: localStorage.getItem('tt_last_country') === '国内' ? '中国' : (localStorage.getItem('tt_last_country') || '中国'),
    displayName: displayName.value || userName.value,
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
    user: timerForm.value.displayName,
    notes: timerForm.value.notes,
  })
  showStartModal.value = false
}

// ───── 编辑条目 ─────
const showEditModal = ref(false)
const editForm = ref({
  record_id: '',
  description: '',
  category: '',
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
  // 先打开弹窗 (用条目当前的 category), 后台异步刷新该团队分类选项
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
  // 乐观更新: 先改本地 entries 立即显示, 后台异步 PUT, 失败回滚
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
  // 1. 立即更新本地数据
  if (oldEntry) {
    oldEntry.fields = { ...oldEntry.fields, ...newFields }
  }
  showEditModal.value = false
  persistCache()
  // 2. 后台异步同步
  try {
    await http('/entries/' + rid, { method: 'PUT', body: { fields: newFields } })
  } catch (e) {
    // 3. 失败回滚
    if (oldEntry) {
      // 回滚到原始数据 (用 loadEntries 重新拉取最简单可靠)
      await loadEntries()
    }
    alert('保存失败: ' + e.message)
  }
}

async function deleteEntry() {
  if (!confirm('确定删除这条记录？')) return
  // 乐观更新: 先删本地 entries 立即显示, 后台异步 DELETE, 失败回滚
  const rid = editForm.value.record_id
  const oldIdx = entries.value.findIndex(e => e.record_id === rid)
  const oldEntry = oldIdx >= 0 ? entries.value[oldIdx] : null
  // 1. 立即从本地数组删除
  if (oldIdx >= 0) {
    entries.value.splice(oldIdx, 1)
  }
  showEditModal.value = false
  persistCache()
  // 2. 后台异步删除
  try {
    await http('/entries/' + rid, { method: 'DELETE' })
  } catch (e) {
    // 3. 失败回滚: 把删掉的条目插回原位
    if (oldEntry && oldIdx >= 0) {
      entries.value.splice(oldIdx, 0, oldEntry)
    }
    alert('删除失败: ' + e.message)
  }
}

function continueEntry() {
  showEditModal.value = false
  timerForm.value = {
    description: editForm.value.description,
    category: editForm.value.category,
    timezone: 'UTC+8',
    country: '中国',
    displayName: displayName.value || userName.value,
    notes: '',
  }
  showStartModal.value = true
}

function openNewOnDay(d) {
  openStartTimer()
}

// ───── 生命周期 ─────
watch(pendingStartTimer, (v) => {
  if (v && !activeTimer.value) {
    openStartTimer()
    pendingStartTimer.value = false
  }
})

onMounted(() => {
  updateNowLine()
  nowInterval = setInterval(updateNowLine, 60000)
  if (userName.value) loadEntries()
  loadAllCountries()
  loadTeamCategories()
  loadAllCategories()
  // 进入/刷新网页时自动滚动到红线中间
  nextTick(() => setTimeout(scrollToNow, 100))
  // 监听计时事件, 乐观更新本地 entries
  window.addEventListener('timer-stopped', onTimerStopped)
  window.addEventListener('timer-started', onTimerStarted)
  window.addEventListener('timer-record-ready', onTimerRecordReady)
  window.addEventListener('timer-start-failed', onTimerStartFailed)
})

onUnmounted(() => {
  if (nowInterval) clearInterval(nowInterval)
  window.removeEventListener('timer-stopped', onTimerStopped)
  window.removeEventListener('timer-started', onTimerStarted)
  window.removeEventListener('timer-record-ready', onTimerRecordReady)
  window.removeEventListener('timer-start-failed', onTimerStartFailed)
})

// 计时开始: 乐观插入本地条目, 周视图马上看到
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
      end_time: d.end_time,  // null = 计时中
    },
  })
  persistCache()
}

// /timer/start 返回真 record_id: 替换 temp_id
function onTimerRecordReady(e) {
  const { temp_id, record_id, start_time } = e.detail || {}
  const entry = entries.value.find(en => en.record_id === temp_id)
  if (entry) {
    entry.record_id = record_id
    if (start_time) entry.fields.start_time = start_time
  }
  persistCache()
}

// /timer/start 失败: 删除本地临时条目
function onTimerStartFailed(e) {
  const { temp_id } = e.detail || {}
  entries.value = entries.value.filter(en => en.record_id !== temp_id)
  persistCache()
}

// 计时完成时, 立即更新本地 entries 的 end_time, 不等 loadEntries
function onTimerStopped(e) {
  const { record_id, end_time } = e.detail || {}
  if (!record_id) return
  const entry = entries.value.find(en => en.record_id === record_id)
  if (entry) {
    entry.fields['end_time'] = end_time
  }
  persistCache()
}
</script>

<style scoped>
.week-view {
  max-width: 1400px;
  margin: 0 auto;
}

/* 国家检索下拉 */
.country-search-wrap {
  position: relative;
}
.country-search-input {
  width: 100%;
  padding: 6px 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  font-size: 13px;
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
  background: var(--surface-light);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  box-shadow: var(--shadow);
  z-index: 200;
  margin-top: 2px;
}
.country-option {
  padding: 6px 10px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.country-option:hover {
  background: var(--surface-hover);
  color: var(--primary);
}
.country-option.active {
  background: var(--primary);
  color: var(--bg);
}
.country-code {
  font-size: 11px;
  color: var(--text-secondary);
}
.country-option.active .country-code {
  color: #e0e7ff;
}
.country-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

/* 成员检索下拉 */
.member-search-wrap {
  position: relative;
  display: inline-block;
}
.member-search-input {
  padding: 4px 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  font-size: 13px;
  width: 160px;
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
  max-height: 240px;
  overflow-y: auto;
  background: var(--surface-light);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  box-shadow: var(--shadow);
  z-index: 100;
  margin-top: 2px;
}
.member-option {
  padding: 6px 10px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.member-option:hover {
  background: var(--surface-hover);
  color: var(--primary);
}
.member-option.active {
  background: var(--primary);
  color: var(--bg);
}
.member-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: 8px;
}
.member-option.active .member-sub {
  color: #e0e7ff;
}
.member-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.page-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* 固定顶部工具栏 (顶满宽度, 不挡侧边栏) */
.week-toolbar {
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
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
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
  color: var(--text);
}
.toolbar-timer.is-running {
  border: 1px solid var(--primary);
  box-shadow: 0 0 12px var(--primary-glow);
}
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
  background: var(--bg);
}
.timer-elapsed {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
  color: var(--primary);
  text-shadow: 0 0 8px var(--primary-glow);
}
.timer-idle {
  font-size: 16px;
  opacity: 0.5;
}
.timer-idle-text {
  color: var(--text-secondary);
  font-weight: 500;
}
.timer-start {
  padding: 5px 14px;
  background: var(--primary);
  color: var(--bg);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  text-shadow: 0 0 8px var(--primary-glow);
}
.timer-start:hover {
  background: var(--surface-hover);
  color: var(--primary);
  box-shadow: 0 0 12px var(--primary-glow);
}
.timer-stop {
  padding: 5px 12px;
  background: var(--danger);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.timer-stop:hover {
  background: rgba(255, 51, 102, 0.8);
  box-shadow: 0 0 12px rgba(255, 51, 102, 0.4);
}

.nav-arrow {
  background: none;
  border: none;
  font-size: 32px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px 10px;
  line-height: 1;
  font-weight: 700;
}

.nav-arrow:hover {
  color: var(--primary);
  text-shadow: 0 0 8px var(--primary-glow);
}

/* 放大查看下拉的倒三角箭头 */
.view-switch select,
.toolbar-right select {
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

.week-range {
  font-weight: 600;
  min-width: 180px;
  color: var(--text);
  text-shadow: 0 0 8px var(--primary-glow);
}

.today-btn {
  padding: 4px 12px;
  border: 1px solid var(--border-light);
  background: var(--surface);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  transition: all 0.15s;
}

.today-btn:hover {
  background: var(--surface-hover);
  color: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 0 12px var(--primary-glow);
}

.zoom-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

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
.show-name-toggle input {
  cursor: pointer;
}

.zoom-control input[type="range"] {
  width: 100px;
}

.zoom-value {
  min-width: 60px;
}

.cal {
  display: grid;
  grid-template-columns: 60px repeat(7, 1fr);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  align-items: start;
  /* 让 .cal 自己滚动, 表头 sticky 才能生效 */
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

.day-col {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
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

.day-head.today {
  background: rgba(0, 212, 255, 0.1);
}

.dow {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.dnum {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
}

.dtotal {
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.dtotal.has {
  color: var(--primary);
  font-weight: 600;
}

.day-body {
  position: relative;
  cursor: pointer;
}

.now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--danger);
  z-index: 10;
  pointer-events: none;
}

.now-line::before {
  content: '';
  position: absolute;
  left: -4px;
  top: -3px;
  width: 8px;
  height: 8px;
  background: var(--danger);
  border-radius: 50%;
}

.entry {
  position: absolute;
  left: 2px;
  right: 2px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
  font-size: 11px;
  z-index: 5;
}

.entry:hover {
  z-index: 6;
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
}

.e-title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 6px;
}

.running-tag {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--bg);
  background: var(--success);
  border-radius: 8px;
  animation: pulse-tag 1.5s ease-in-out infinite;
  flex-shrink: 0;
  box-shadow: 0 0 8px rgba(0, 255, 136, 0.4);
}

@keyframes pulse-tag {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.entry.is-running {
  outline: 2px solid var(--success);
  outline-offset: -1px;
  box-shadow: 0 0 8px rgba(0, 255, 136, 0.3);
}

/* 短时长条目: 显示为分类颜色的细线, hover 时展开为放得下字高的彩色块 */
.entry.is-short {
  height: 3px !important;
  border-left: none;
  border-radius: 2px;
  overflow: visible;
  cursor: pointer;
}
.entry.is-short .e-title,
.entry.is-short .e-time,
.entry.is-short .e-dur {
  display: none;
}
.entry.is-short:hover {
  height: 45px !important;
  border-radius: 4px;
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
  z-index: 20;
}
.entry.is-short:hover .e-title {
  display: block;
  font-size: 11px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 4px 6px;
}
.entry.is-short:hover .e-time {
  display: block !important;
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.9;
  padding: 0 6px;
}
.entry.is-short:hover .e-dur {
  display: none !important;
}

.e-time {
  color: var(--text-secondary);
  margin-top: 2px;
}

.week-sum {
  text-align: right;
  padding: 16px;
  font-size: 14px;
  color: var(--text-secondary);
}

.week-sum strong {
  color: var(--primary);
  font-size: 16px;
  text-shadow: 0 0 8px var(--primary-glow);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
</style>
