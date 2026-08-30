<template>
  <div class="app">
    <!-- 登录/注册弹窗 -->
    <div v-if="showLogin" class="auth-mask">
      <div class="auth-card">
        <div class="auth-logo">⏱</div>
        <div class="auth-title">{{ showRegister ? '注册新账号' : '欢迎使用时间追踪' }}</div>

        <!-- 登录表单 -->
        <template v-if="!showRegister">
          <div class="auth-field">
            <label>用户名</label>
            <input v-model="loginUser" placeholder="您的用户名" autofocus @keyup.enter="$refs.passInput.focus()" />
          </div>
          <div class="auth-field">
            <label>密码</label>
            <input ref="passInput" type="password" v-model="loginPass" placeholder="您的密码" @keyup.enter="confirmLogin" />
          </div>
          <div v-if="loginError" class="auth-err">{{ loginError }}</div>
          <button class="auth-btn" @click="confirmLogin" :disabled="authLoading">
            {{ authLoading ? '登录中...' : '登录' }}
          </button>
          <div class="auth-divider"><span>或</span></div>
          <button class="auth-btn feishu-btn" @click="redirectToFeishuAuth">
            🚀 飞书一键登录
          </button>
          <div class="auth-switch">
            没有账号？<a @click="toggleRegister">立即注册</a>
          </div>
        </template>

        <!-- 注册表单 -->
        <template v-else>
          <div class="auth-field">
            <label>邀请码</label>
            <input v-model="regInvite" placeholder="管理员发给您的邀请码" autofocus />
          </div>
          <div class="auth-field">
            <label>姓名</label>
            <input v-model="regDisplayName" placeholder="您的姓名（如 Jenny Chee）" />
          </div>
          <div class="auth-field">
            <label>用户名</label>
            <input v-model="regUser" placeholder="登录用户名" />
          </div>
          <div class="auth-field">
            <label>密码</label>
            <input type="password" v-model="regPass" placeholder="设置密码" />
          </div>
          <div class="auth-field">
            <label>确认密码</label>
            <input type="password" v-model="regPass2" placeholder="再输入一遍密码" @keyup.enter="doRegister" />
          </div>
          <div v-if="regError" class="auth-err">{{ regError }}</div>
          <button class="auth-btn" @click="doRegister" :disabled="authLoading">
            {{ authLoading ? '注册中...' : '注册' }}
          </button>
          <div class="auth-switch">
            已有账号？<a @click="toggleRegister">返回登录</a>
          </div>
        </template>
      </div>
    </div>

    <!-- 主布局 -->
    <div v-if="userName && !showLogin" class="layout">
      <!-- 侧边栏 -->
      <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="sidebar-header">
          <span v-if="!sidebarCollapsed" class="sidebar-brand">⏱ 时间追踪</span>
          <span v-else class="sidebar-brand-icon">⏱</span>
        </div>

        <nav class="sidebar-nav">
          <button
            v-for="item in navItems"
            :key="item.key"
            class="nav-item"
            :class="{ active: item.noNav || currentPage === item.key }"
            @click="!item.noNav && (currentPage = item.key)"
            :title="item.label"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            <span v-if="!sidebarCollapsed" class="nav-label">{{ item.label }}</span>
          </button>
        </nav>

        <div class="sidebar-footer">
          <div v-if="!sidebarCollapsed" class="user-info">
            <div class="user-avatar">{{ (displayName || userName).charAt(0).toUpperCase() }}</div>
            <div class="user-details">
              <div class="user-name">{{ displayName || userName }}</div>
              <div class="user-role">{{ roleLabel }}</div>
            </div>
          </div>
          <button class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed">
            {{ sidebarCollapsed ? '▶' : '◀ 收起' }}
          </button>
          <button v-if="!sidebarCollapsed" class="logout-btn" @click="logout">退出登录</button>
        </div>
      </aside>

      <!-- 主内容区 -->
      <main class="main-content">
        <!-- 顶部视图切换横栏 (只在周/日/列表视图显示, 设置页不显示) -->
        <div v-if="currentPage !== 'settings'" class="top-switch-bar">
          <!-- 日历视图 + 下拉箭头 (切周/日) -->
          <div class="switch-group" ref="switchGroupRef">
            <button
              class="switch-arrow"
              :class="{ open: showCalendarDropdown }"
              @click.stop="showCalendarDropdown = !showCalendarDropdown"
              title="切换周/日视图"
            >▾</button>
            <button
              class="switch-btn"
              :class="{ active: currentPage === 'week' || currentPage === 'day' }"
              @click="currentPage = calendarMode"
              title="日历视图"
            >
              <span class="switch-icon">📅</span>
              <span class="switch-label">日历视图</span>
              <span class="switch-sub">({{ calendarMode === 'week' ? '周' : '日' }})</span>
            </button>
            <div v-if="showCalendarDropdown" class="switch-dropdown">
              <div
                class="dropdown-item"
                :class="{ active: calendarMode === 'week' }"
                @click="calendarMode = 'week'; currentPage = 'week'; showCalendarDropdown = false"
              >
                <span>📅</span> 周视图
              </div>
              <div
                class="dropdown-item"
                :class="{ active: calendarMode === 'day' }"
                @click="calendarMode = 'day'; currentPage = 'day'; showCalendarDropdown = false"
              >
                <span>📆</span> 日视图
              </div>
            </div>
          </div>

          <!-- 列表视图 -->
          <button
            class="switch-btn"
            :class="{ active: currentPage === 'list' }"
            @click="currentPage = 'list'"
            title="列表视图"
          >
            <span class="switch-icon">📋</span>
            <span class="switch-label">列表视图</span>
          </button>
        </div>

        <!-- 仪表盘页 -->
        <Dashboard v-if="currentPage === 'dashboard'" />
        <!-- 周视图页 -->
        <WeekView v-else-if="currentPage === 'week'" />
        <!-- 列表视图页 -->
        <ListView v-else-if="currentPage === 'list'" />
        <!-- 日视图页 -->
        <DayView v-else-if="currentPage === 'day'" />
        <!-- 设置页 -->
        <Settings v-else-if="currentPage === 'settings'" />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, provide, watch } from 'vue'
import WeekView from './views/WeekView.vue'
import ListView from './views/ListView.vue'
import DayView from './views/DayView.vue'
import Settings from './views/Settings.vue'
import Dashboard from './views/Dashboard.vue'

// ───── HTTP 工具 ─────
const API_BASE = 'https://1473537498-ejcp1i6ib6.ap-shanghai.tencentscf.com'
async function http(path, options = {}) {
  const url = path.startsWith('http') ? path : API_BASE + path
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ───── 登录状态 ─────
const userName = ref(localStorage.getItem('tt_user') || '')
const userRole = ref(localStorage.getItem('tt_role') || '')
const displayName = ref(localStorage.getItem('tt_display_name') || '')
const userTeam = ref(localStorage.getItem('tt_team') || '')
const feishuUserId = ref(localStorage.getItem('tt_feishu_id') || '')
const showLogin = ref(!userName.value)
const authLoading = ref(false)

const isAdmin = computed(() => userRole.value === 'admin')

// 角色标签
const roleLabel = computed(() => {
  const r = userRole.value
  if (r === 'admin') return '管理员'
  if (r === 'team_admin') return '团队管理员'
  if (r === 'member') return '团队成员'
  return '员工'
})

// ───── 飞书 H5 免登 ─────
// 飞书企业自建应用 App ID
const FEISHU_APP_ID = 'cli_aa07f5b29ef89bd1'

// 检测 URL 是否有 code 参数(飞书重定向回来), 自动登录
async function tryFeishuAuth() {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (!code) return false

  try {
    const res = await http('/feishu-auth?code=' + encodeURIComponent(code))
    if (res.ok) {
      // 飞书免登成功
      userName.value = res.user
      userRole.value = res.role
      displayName.value = res.display_name
      userTeam.value = res.team || ''
      feishuUserId.value = res.feishu_user_id || ''
      localStorage.setItem('tt_user', res.user)
      localStorage.setItem('tt_role', res.role)
      localStorage.setItem('tt_display_name', res.display_name)
      localStorage.setItem('tt_team', res.team || '')
      localStorage.setItem('tt_feishu_id', res.feishu_user_id || '')
      showLogin.value = false
      // 清掉 URL 里的 code 参数
      url.searchParams.delete('code')
      window.history.replaceState({}, '', url.toString())
      return true
    } else {
      // 飞书账号未绑定, 提示用户去网页端绑定
      console.warn('飞书免登失败:', res.error)
    }
  } catch (e) {
    console.warn('飞书免登异常:', e.message)
  }
  return false
}

// 跳转到飞书授权页(用户点"飞书登录"时调用)
// 统一用飞书 v2 oauth2 全流程:
//   授权端点: https://accounts.feishu.cn/open-apis/authen/v1/authorize
//   换token:  https://open.feishu.cn/open-apis/authen/v2/oauth/token (SCF后端)
function redirectToFeishuAuth() {
  const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname)
  const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${FEISHU_APP_ID}&response_type=code&redirect_uri=${redirectUri}`
  window.location.href = authUrl
}

// 登录表单
const loginUser = ref('')
const loginPass = ref('')
const loginError = ref('')

// 注册表单
const showRegister = ref(false)
const regInvite = ref('')
const regUser = ref('')
const regDisplayName = ref('')
const regPass = ref('')
const regPass2 = ref('')
const regError = ref('')

function toggleRegister() {
  showRegister.value = !showRegister.value
  regError.value = ''
  loginError.value = ''
}

async function confirmLogin() {
  loginError.value = ''
  const u = loginUser.value.trim()
  const p = loginPass.value.trim()
  if (!u || !p) { loginError.value = '用户名和密码必填'; return }
  authLoading.value = true
  try {
    const res = await http('/login', { method: 'POST', body: { username: u, password: p } })
    if (!res.ok) { loginError.value = res.error || '登录失败'; return }
    userName.value = res.user
    userRole.value = res.role
    displayName.value = res.display_name || res.user
    userTeam.value = res.team || ''
    feishuUserId.value = res.feishu_user_id || ''
    localStorage.setItem('tt_user', res.user)
    localStorage.setItem('tt_role', res.role)
    localStorage.setItem('tt_display_name', displayName.value)
    localStorage.setItem('tt_team', res.team || '')
    localStorage.setItem('tt_feishu_id', res.feishu_user_id || '')
    showLogin.value = false
    loginUser.value = ''
    loginPass.value = ''
    // 登录成功后恢复未完成的计时器
    await restoreActiveTimer()
  } catch (e) {
    loginError.value = e.message
  } finally {
    authLoading.value = false
  }
}

async function doRegister() {
  regError.value = ''
  const invite = regInvite.value.trim()
  const u = regUser.value.trim()
  const dn = regDisplayName.value.trim()
  const p = regPass.value.trim()
  const p2 = regPass2.value.trim()
  if (!invite || !u || !p || !p2) { regError.value = '所有字段都必填'; return }
  if (p !== p2) { regError.value = '两次密码不一致'; return }
  authLoading.value = true
  try {
    const res = await http('/register', { method: 'POST', body: { invite_code: invite, username: u, password: p, display_name: dn } })
    if (!res.ok) { regError.value = res.error || '注册失败'; return }
    // 注册成功，自动登录
    userName.value = res.user
    userRole.value = res.role
    displayName.value = res.display_name || res.user
    userTeam.value = res.team || ''
    feishuUserId.value = res.feishu_user_id || ''
    localStorage.setItem('tt_user', res.user)
    localStorage.setItem('tt_role', res.role)
    localStorage.setItem('tt_display_name', displayName.value)
    localStorage.setItem('tt_team', res.team || '')
    localStorage.setItem('tt_feishu_id', res.feishu_user_id || '')
    showLogin.value = false
    showRegister.value = false
    regInvite.value = ''
    regUser.value = ''
    regDisplayName.value = ''
    regPass.value = ''
    regPass2.value = ''
  } catch (e) {
    regError.value = e.message
  } finally {
    authLoading.value = false
  }
}

function logout() {
  if (!confirm('确定退出登录？')) return
  localStorage.removeItem('tt_user')
  localStorage.removeItem('tt_role')
  localStorage.removeItem('tt_display_name')
  // 清理视图状态, 避免下个账号登录时残留上个角色的视图选择
  localStorage.removeItem('tt_view_scope')
  localStorage.removeItem('tt_selected_user')
  localStorage.removeItem('tt_selected_team')
  userName.value = ''
  userRole.value = ''
  displayName.value = ''
  showLogin.value = true
}

// ───── 侧边栏 ─────
const sidebarCollapsed = ref(false)
const currentPage = ref(localStorage.getItem('tt_current_page') || 'week')
// 顶部横栏: 日历视图的当前模式 (week/day)
const calendarMode = ref(localStorage.getItem('tt_calendar_mode') || 'week')
const showCalendarDropdown = ref(false)
const switchGroupRef = ref(null)

// 全局点击: 点 switch-group 外部时关闭日历下拉
function onGlobalClick(e) {
  if (showCalendarDropdown.value && switchGroupRef.value && !switchGroupRef.value.contains(e.target)) {
    showCalendarDropdown.value = false
  }
}
onMounted(() => document.addEventListener('click', onGlobalClick))
onUnmounted(() => document.removeEventListener('click', onGlobalClick))

// 持久化当前页面和日历模式, 刷新后恢复
watch(currentPage, (v) => localStorage.setItem('tt_current_page', v))
watch(calendarMode, (v) => localStorage.setItem('tt_calendar_mode', v))

// 横条"开始计时"按钮：跳到周视图并触发弹窗
const pendingStartTimer = ref(false)
function openStartFromBar() {
  currentPage.value = 'week'
  pendingStartTimer.value = true
}
provide('pendingStartTimer', pendingStartTimer)
provide('currentPage', currentPage)
provide('setPage', (key) => { currentPage.value = key })

// 侧边栏: 视图(仅标识当前视图, 点击不跳转) + 设置
const navItems = computed(() => {
  // 周/日/列表都属于"视图", 点击不跳转
  const isView = currentPage.value === 'week' || currentPage.value === 'day' || currentPage.value === 'list'
  return [
    { key: 'dashboard', icon: '📈', label: '仪表盘' },
    { key: isView ? currentPage.value : 'week', icon: '📊', label: '视图', noNav: isView },
    { key: 'settings', icon: '⚙', label: '设置' },
  ]
})

// ───── 分类管理（全局共享，存 localStorage）─────
const defaultCategories = [
  { name: '工签', color: '#6366f1' },
  { name: '会议', color: '#10b981' },
  { name: '培训', color: '#f59e0b' },
  { name: '其他', color: '#6b7280' },
]
const categories = ref(JSON.parse(localStorage.getItem('tt_categories') || 'null') || defaultCategories)

function saveCategories() {
  localStorage.setItem('tt_categories', JSON.stringify(categories.value))
}

function addCategory(name, color) {
  if (categories.value.find(c => c.name === name)) return false
  categories.value.push({ name, color })
  saveCategories()
  return true
}

function removeCategory(name) {
  if (name === '其他') return false // "其他"不能删
  categories.value = categories.value.filter(c => c.name !== name)
  saveCategories()
  return true
}

function getCategoryColor(name) {
  const cat = categories.value.find(c => c.name === name)
  return cat ? cat.color : '#6b7280'
}

// ───── 国家管理（自定义，默认国内）─────
const defaultCountries = ['国内', '其他']
const countries = ref(JSON.parse(localStorage.getItem('tt_countries') || 'null') || defaultCountries)

function saveCountries() {
  localStorage.setItem('tt_countries', JSON.stringify(countries.value))
}

// ───── 时区列表（全覆盖）─────
const timezones = [
  { value: 'UTC+8', label: 'UTC+8 北京/上海' },
  { value: 'UTC+9', label: 'UTC+9 东京/首尔' },
  { value: 'UTC+10', label: 'UTC+10 悉尼/墨尔本' },
  { value: 'UTC+11', label: 'UTC+11 所罗门群岛' },
  { value: 'UTC+12', label: 'UTC+12 奥克兰/惠灵顿' },
  { value: 'UTC+13', label: 'UTC+13 萨摩亚/汤加' },
  { value: 'UTC+14', label: 'UTC+14 莱恩群岛' },
  { value: 'UTC+7', label: 'UTC+7 曼谷/雅加达' },
  { value: 'UTC+6', label: 'UTC+6 达卡/阿斯塔纳' },
  { value: 'UTC+5', label: 'UTC+5 卡拉奇/塔什干' },
  { value: 'UTC+4', label: 'UTC+4 迪拜/巴库' },
  { value: 'UTC+3', label: 'UTC+3 莫斯科/伊斯坦布尔' },
  { value: 'UTC+2', label: 'UTC+2 开罗/雅典' },
  { value: 'UTC+1', label: 'UTC+1 巴黎/柏林' },
  { value: 'UTC+0', label: 'UTC+0 伦敦/都柏林' },
  { value: 'UTC-1', label: 'UTC-1 佛得角/亚速尔' },
  { value: 'UTC-2', label: 'UTC-2 中大西洋' },
  { value: 'UTC-3', label: 'UTC-3 圣保罗/布宜诺斯艾利斯' },
  { value: 'UTC-4', label: 'UTC-4 纽约/多伦多（夏令时）' },
  { value: 'UTC-5', label: 'UTC-5 芝加哥/墨西哥城' },
  { value: 'UTC-6', label: 'UTC-6 丹佛/中美洲' },
  { value: 'UTC-7', label: 'UTC-7 洛杉矶/温哥华' },
  { value: 'UTC-8', label: 'UTC-8 旧金山/西雅图（夏令时）' },
  { value: 'UTC-9', label: 'UTC-9 阿拉斯加' },
  { value: 'UTC-10', label: 'UTC-10 夏威夷' },
  { value: 'UTC-11', label: 'UTC-11 中途岛/萨摩亚' },
  { value: 'UTC-12', label: 'UTC-12 国际日期变更线' },
]

// ───── 实时计时器（全局状态）─────
// activeTimer 结构: { record_id, description, category, color, country, user, notes, startTime }
const activeTimer = ref(null)
const timerTick = ref(0)
let timerInterval = null

const timerElapsedMs = computed(() => {
  timerTick.value // 依赖触发重算
  if (!activeTimer.value) return 0
  return Date.now() - activeTimer.value.startTime
})

const timerElapsedText = computed(() => {
  const ms = timerElapsedMs.value
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
})

// 把计时状态存到 localStorage + cookie（cookie 防清缓存，localStorage 主存）
function persistTimer() {
  if (activeTimer.value) {
    const data = {
      record_id: activeTimer.value.record_id,
      startTime: activeTimer.value.startTime,
      description: activeTimer.value.description,
      category: activeTimer.value.category,
      color: activeTimer.value.color,
      country: activeTimer.value.country,
      user: activeTimer.value.user,
      notes: activeTimer.value.notes,
    }
    localStorage.setItem('tt_active_timer', JSON.stringify(data))
    // cookie 备份（有效期 7 天），格式: record_id|start_time
    const cookieVal = `${data.record_id}|${data.startTime}`
    document.cookie = `tt_timer=${cookieVal}; max-age=604800; path=/`
  } else {
    localStorage.removeItem('tt_active_timer')
    document.cookie = 'tt_timer=; max-age=0; path=/'
  }
}

// 开始计时：乐观插入本地条目立即显示, 后台异步拿真 record_id
async function startActiveTimer(payload) {
  // payload: { description, category, color, country, user, notes }
  const startTime = Date.now()
  const tempId = 'temp_' + startTime
  // 1. 乐观更新: 立即设置 activeTimer, 横条马上显示
  activeTimer.value = {
    ...payload,
    record_id: tempId,
    startTime: startTime,
  }
  persistTimer()
  if (timerInterval) clearInterval(timerInterval)
  timerInterval = setInterval(() => { timerTick.value++ }, 1000)
  // 2. 乐观插入本地 entries, 周视图马上看到这条
  window.dispatchEvent(new CustomEvent('timer-started', {
    detail: {
      record_id: tempId,
      description: payload.description || '',
      category: payload.category || '其他',
      user: payload.user || '',
      country: payload.country || '国内',
      start_time: startTime,
      end_time: null,  // 计时中
    }
  }))
  // 3. 后台异步调 /timer/start 拿真 record_id
  try {
    const res = await http('/timer/start', {
      method: 'POST',
      body: {
        user: payload.user || '',
        description: payload.description || '',
        category: payload.category || '其他',
        country: payload.country || '国内',
        notes: payload.notes || '',
      },
    })
    // 4. 用真 record_id 替换临时 id
    activeTimer.value.record_id = res.record_id
    persistTimer()
    // 5. 通知 WeekView 用真 record_id 替换
    window.dispatchEvent(new CustomEvent('timer-record-ready', {
      detail: { temp_id: tempId, record_id: res.record_id, start_time: res.start_time }
    }))
  } catch (e) {
    // 失败: 清理横条 + 删本地条目
    activeTimer.value = null
    persistTimer()
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
    window.dispatchEvent(new CustomEvent('timer-start-failed', {
      detail: { temp_id: tempId }
    }))
    alert('开始计时失败: ' + e.message)
  }
}

// 完成计时：调 /timer/stop 补全 end_time
async function stopActiveTimer() {
  if (!activeTimer.value) return
  const t = activeTimer.value
  const endTime = Date.now()

  // 如果 record_id 还是临时 id (temp_xxx), 等 /timer/start 返回真 id
  // 最多等 10 秒, 超时就放弃 (用户会看到错误提示)
  let realRecordId = t.record_id
  if (typeof realRecordId === 'string' && realRecordId.startsWith('temp_')) {
    for (let i = 0; i < 100; i++) {
      // activeTimer 被 startActiveTimer 清空了 (/timer/start 失败), 跳出
      if (!activeTimer.value) {
        break
      }
      // activeTimer 还活着, startActiveTimer 会更新它的 record_id
      if (!String(activeTimer.value.record_id).startsWith('temp_')) {
        realRecordId = activeTimer.value.record_id
        break
      }
      await new Promise(r => setTimeout(r, 100))
    }
  }

  // 1. 立即清理横条和计时器, 用户秒级响应
  activeTimer.value = null
  persistTimer()
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null }

  // 2. 乐观更新: 立即通知 WeekView 更新本地 entries 的 end_time
  window.dispatchEvent(new CustomEvent('timer-stopped', {
    detail: { record_id: realRecordId, end_time: endTime }
  }))

  // 3. 后台异步同步, 不阻塞用户
  try {
    await http('/timer/stop', {
      method: 'POST',
      body: { record_id: realRecordId },
    })
  } catch (e) {
    // 失败: 计时器可能是孤儿 (飞书表里没这条记录), 直接清理, 不恢复横条
    console.error('完成计时失败:', e.message)
    activeTimer.value = null
    persistTimer()
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
    window.dispatchEvent(new CustomEvent('timer-stopped', {
      detail: { record_id: realRecordId, end_time: endTime }
    }))
    // 只在真正网络错误时提示, 孤儿记录静默清理
    if (!e.message.includes('RecordIdNotFound') && !e.message.includes('HTTP 500')) {
      alert('完成计时失败: ' + e.message)
    }
  }
}

// 从服务端恢复正在进行的计时器（刷新/重启后）
// 核心逻辑: 直接信任 localStorage 里的 record_id 和 startTime
// 用 /timer/active 只是为了拿服务端的 start_time (毫秒) 覆盖 localStorage 里可能过期的值
// 不做 record_id 匹配 (因为 /timer/active 返回最早的, 不是最新的)
async function restoreActiveTimer() {
  // 1. 先尝试从 localStorage 恢复
  let saved = localStorage.getItem('tt_active_timer')
  // 2. localStorage 没有就从 cookie 读
  if (!saved) {
    const m = document.cookie.match(/tt_timer=([^;]+)/)
    if (m) {
      const [cookieRecordId, cookieStartTime] = m[1].split('|')
      if (cookieRecordId && userName.value) {
        try {
          const res = await http(`/timer/active?user=${encodeURIComponent(userName.value)}`)
          if (res.active) {
            // 用服务端的 start_time (毫秒), fallback 到 cookie 里的值
            const startTime = Number(res.start_time) || Number(cookieStartTime) || Date.now()
            activeTimer.value = {
              record_id: cookieRecordId,
              startTime: startTime,
              description: res.description || '',
              category: res.category || '其他',
              color: '#6366f1',
              user: userName.value,
              country: '国内',
              notes: '',
            }
            persistTimer()
            if (timerInterval) clearInterval(timerInterval)
            timerInterval = setInterval(() => { timerTick.value++ }, 1000)
          }
        } catch (e) { /* 忽略 */ }
      }
      return
    }
  }

  // 3. localStorage 有数据, 直接恢复 (不依赖 /timer/active 的 record_id 匹配)
  if (saved) {
    try {
      const data = JSON.parse(saved)
      if (data.record_id && data.startTime) {
        // 强制转数字, 避免 localStorage 存的是字符串
        const startTime = Number(data.startTime)
        if (!isNaN(startTime) && startTime > 0) {
          activeTimer.value = {
            record_id: data.record_id,
            startTime: startTime,
            description: data.description || '',
            category: data.category || '其他',
            color: data.color || '#6366f1',
            user: data.user || userName.value,
            country: data.country || '国内',
            notes: data.notes || '',
          }
          persistTimer()
          if (timerInterval) clearInterval(timerInterval)
          timerInterval = setInterval(() => { timerTick.value++ }, 1000)
          return
        }
      }
      // localStorage 数据无效, 清理
      localStorage.removeItem('tt_active_timer')
      document.cookie = 'tt_timer=; max-age=0; path=/'
    } catch (e) {
      localStorage.removeItem('tt_active_timer')
    }
  }
}

// ───── provide 给子组件 ─────
provide('http', http)
provide('userName', userName)
provide('userRole', userRole)
provide('displayName', displayName)
provide('isAdmin', isAdmin)
provide('categories', categories)
provide('addCategory', addCategory)
provide('removeCategory', removeCategory)
provide('getCategoryColor', getCategoryColor)
provide('saveCategories', saveCategories)
provide('countries', countries)
provide('saveCountries', saveCountries)
provide('timezones', timezones)
provide('logout', logout)
provide('activeTimer', activeTimer)
provide('startActiveTimer', startActiveTimer)
provide('stopActiveTimer', stopActiveTimer)
provide('timerElapsedText', timerElapsedText)
provide('redirectToFeishuAuth', redirectToFeishuAuth)
provide('feishuUserId', feishuUserId)
provide('userTeam', userTeam)

// ───── 全局显示姓名开关 (所有视图共享) ─────
const showUserName = ref(localStorage.getItem('tt_show_user_name') === 'true')
watch(showUserName, (v) => localStorage.setItem('tt_show_user_name', String(v)))
provide('showUserName', showUserName)

// ───── onMounted: 自动恢复计时器 ─────
// 刷新页面时, 如果 localStorage 有 tt_user, 会跳过登录直接进主界面
// 但 restoreActiveTimer 只在 confirmLogin 里调用, 刷新时不会触发
// 所以这里要在 onMounted 里主动恢复
onMounted(async () => {
  // 如果已登录(从 localStorage 恢复), 但计时器没恢复, 主动调 restoreActiveTimer
  if (userName.value && !activeTimer.value) {
    await restoreActiveTimer()
  }
})
</script>

<style>
/* ───── 全局样式 ───── */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --primary: #6366f1;
  --primary-light: #818cf8;
  --primary-dark: #4f46e5;
  --bg: #f9fafb;
  --surface: #ffffff;
  --text: #1f2937;
  --text-secondary: #6b7280;
  --border: #e5e7eb;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.1);
  --sidebar-width: 220px;
  --sidebar-collapsed: 60px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
}

.app {
  min-height: 100vh;
}

/* ───── 登录/注册弹窗 ───── */
.auth-mask {
  position: fixed;
  inset: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.auth-card {
  background: var(--surface);
  border-radius: 12px;
  padding: 40px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.auth-logo {
  font-size: 48px;
  text-align: center;
  margin-bottom: 16px;
}

.auth-title {
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 32px;
  color: var(--text);
}

.auth-field {
  margin-bottom: 20px;
}

.auth-field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.auth-field input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.auth-field input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.auth-err {
  background: #fef2f2;
  color: var(--danger);
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 13px;
  margin-bottom: 16px;
}

.auth-btn {
  width: 100%;
  padding: 12px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: var(--radius);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.auth-btn:hover:not(:disabled) {
  background: var(--primary-dark);
}

.auth-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.auth-switch {
  text-align: center;
  margin-top: 20px;
  color: var(--text-secondary);
  font-size: 13px;
}

.auth-switch a {
  color: var(--primary);
  cursor: pointer;
  text-decoration: none;
}

.auth-switch a:hover {
  text-decoration: underline;
}

/* ───── 主布局 ───── */
.layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ───── 侧边栏 ───── */
.sidebar {
  width: var(--sidebar-width);
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed);
}

.sidebar-header {
  padding: 20px 16px;
  border-bottom: 1px solid var(--border);
}

.sidebar-brand {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.sidebar-brand-icon {
  font-size: 24px;
  display: block;
  text-align: center;
}

.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: var(--bg);
  color: var(--text);
}

.nav-item.active {
  background: rgba(99, 102, 241, 0.1);
  color: var(--primary);
  font-weight: 500;
}

.nav-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.nav-label {
  white-space: nowrap;
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 12px;
}

.sidebar-footer {
  padding: 12px 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
}

.user-details {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 11px;
  color: var(--text-secondary);
}

.collapse-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background 0.15s;
}

.collapse-btn:hover {
  background: var(--bg);
}

.logout-btn {
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--danger);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  border-radius: var(--radius);
  transition: background 0.15s;
}

.logout-btn:hover {
  background: #fef2f2;
}

/* ───── 顶部视图切换横栏 (固定, 顶满宽度, 不挡侧边栏) ───── */
.top-switch-bar {
  position: fixed;
  top: 0;
  left: var(--sidebar-width);
  right: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 8px 24px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  height: 48px;
  box-sizing: border-box;
}
.switch-group {
  position: relative;
  display: flex;
  align-items: stretch;
}
.switch-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.15s;
}
.switch-btn:hover { color: var(--text); background: rgba(0,0,0,0.04); }
.switch-btn.active {
  background: var(--surface);
  color: var(--primary);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.switch-icon { font-size: 14px; }
.switch-sub { font-size: 11px; color: var(--text-secondary); font-weight: 400; }
.switch-btn.active .switch-sub { color: var(--primary); }
.switch-arrow {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.15s;
}
.switch-arrow:hover { color: var(--text); background: rgba(0,0,0,0.04); }
.switch-arrow.open { color: var(--primary); }
.switch-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 1000;
  min-width: 140px;
  overflow: hidden;
}
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text);
}
.dropdown-item:hover { background: var(--bg); }
.dropdown-item.active {
  color: var(--primary);
  font-weight: 500;
  background: rgba(99, 102, 241, 0.08);
}

/* ───── 主内容区 ───── */
.main-content {
  flex: 1;
  padding: 24px;
  padding-top: 108px;
  overflow-y: auto;
  position: relative;
}

/* ───── 顶部固定计时器横条（常驻，居中胶囊式）───── */
.timer-bar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  min-width: 420px;
  max-width: 720px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 0, 0, 0.04);
}

.timer-bar.is-running {
  border: 1px solid transparent;
}

.timer-bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.timer-idle {
  font-size: 22px;
  opacity: 0.4;
}

.timer-bar-idle-text {
  font-size: 15px;
  color: var(--text-secondary);
  font-weight: 500;
}

.timer-pulse {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 0 0 currentColor;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}

.timer-bar-desc {
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.timer-bar-cat {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.6);
}

.timer-bar-right {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-shrink: 0;
}

.timer-bar-elapsed {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
}

.timer-bar-start {
  padding: 8px 18px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
  box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
}

.timer-bar-start:hover {
  background: var(--primary-dark);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(99, 102, 241, 0.4);
}

.timer-bar-stop {
  padding: 8px 18px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3);
}

.timer-bar-stop:hover {
  background: #dc2626;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(239, 68, 68, 0.4);
}

/* ───── 通用组件样式 ───── */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s, opacity 0.15s;
}

.btn-primary {
  background: var(--primary);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-dark);
}

.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-secondary:hover {
  background: var(--bg);
}

.btn-danger {
  background: var(--danger);
  color: white;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px;
}

.stat-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
}

.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 768px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
}

.chart-container {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px;
  min-height: 300px;
}

.chart-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text);
}

/* ───── 表格样式 ───── */
.data-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
}

.data-table th,
.data-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.data-table th {
  background: var(--bg);
  font-weight: 600;
  font-size: 13px;
  color: var(--text-secondary);
}

.data-table tbody tr:hover {
  background: var(--bg);
}

/* ───── 弹窗样式 ───── */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  background: var(--surface);
  border-radius: 12px;
  padding: 28px;
  width: 480px;
  max-width: 90vw;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  line-height: 1;
}

.modal-close:hover {
  color: var(--text);
}

.form-field {
  margin-bottom: 16px;
}

.form-field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--text-secondary);
}

.form-field label .required {
  color: var(--danger);
}

.form-field input,
.form-field select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-field input:focus,
.form-field select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.form-field textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

/* ───── 滚动条美化 ───── */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg);
}

::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}
</style>
