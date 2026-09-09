<template>
  <div class="app">
    <!-- 登录/注册弹窗 -->
    <div v-if="showLogin" class="auth-mask">
      <div class="auth-card">
        <LanguagePicker />
        <div class="auth-logo"><AppIcon name="clock" /></div>
        <div class="auth-title">{{ showRegister ? ui("注册新账号") : ui("欢迎使用 Time Tracking") }}</div>

        <!-- 登录表单 -->
        <template v-if="!showRegister">
          <div class="auth-field">
            <label for="app-field-1">{{ ui("用户名") }}</label>
            <input name="app-control-1" id="app-field-1" autocomplete="username" v-model="loginUser" :placeholder="ui(&quot;您的用户名&quot;)" autofocus @keyup.enter="$refs.passInput.focus()" />
          </div>
          <div class="auth-field">
            <label for="app-field-2">{{ ui("密码") }}</label>
            <input name="app-control-2" id="app-field-2" ref="passInput" type="password" autocomplete="current-password" v-model="loginPass" :placeholder="ui(&quot;您的密码&quot;)" @keyup.enter="confirmLogin" />
          </div>
          <div v-if="loginError" class="auth-err">{{ ui(loginError) }}</div>
          <button class="auth-btn" @click="confirmLogin" :disabled="authLoading">
            {{ authLoading ? ui("登录中...") : ui("登录") }}
          </button>
          <div class="auth-divider"><span>{{ ui("或") }}</span></div>
          <button class="auth-btn feishu-btn" @click="redirectToFeishuAuth">
            <AppIcon name="link" />{{ ui("🚀 飞书一键登录") }}
          </button>
          <div class="auth-switch">
            {{ ui("没有账号？") }}<a @click="toggleRegister">{{ ui("立即注册") }}</a>
          </div>
        </template>

        <!-- 注册表单 -->
        <template v-else>
          <div class="auth-field">
            <label for="app-field-3">{{ ui("邀请码") }}</label>
            <input name="app-control-3" id="app-field-3" v-model="regInvite" :placeholder="ui(&quot;管理员发给您的邀请码&quot;)" autofocus />
          </div>
          <div class="auth-field">
            <label for="app-field-4">{{ ui("姓名") }}</label>
            <input name="app-control-4" id="app-field-4" autocomplete="name" v-model="regDisplayName" :placeholder="ui(&quot;您的姓名（如 Jenny Chee）&quot;)" />
          </div>
          <div class="auth-field">
            <label for="app-field-5">{{ ui("用户名") }}</label>
            <input name="app-control-5" id="app-field-5" autocomplete="username" v-model="regUser" :placeholder="ui(&quot;登录用户名&quot;)" />
          </div>
          <div class="auth-field">
            <label for="app-field-6">{{ ui("密码") }}</label>
            <input name="app-control-6" id="app-field-6" type="password" autocomplete="new-password" v-model="regPass" :placeholder="ui(&quot;设置密码&quot;)" />
          </div>
          <div class="auth-field">
            <label for="app-field-7">{{ ui("确认密码") }}</label>
            <input name="app-control-7" id="app-field-7" type="password" autocomplete="new-password" v-model="regPass2" :placeholder="ui(&quot;再输入一遍密码&quot;)" @keyup.enter="doRegister" />
          </div>
          <div v-if="regError" class="auth-err">{{ ui(regError) }}</div>
          <button class="auth-btn" @click="doRegister" :disabled="authLoading">
            {{ authLoading ? ui("注册中...") : ui("注册") }}
          </button>
          <div class="auth-switch">
            {{ ui("已有账号？") }}<a @click="toggleRegister">{{ ui("返回登录") }}</a>
          </div>
        </template>
      </div>
    </div>

    <!-- 主布局 -->
    <div v-if="userName && !showLogin" :key="userName" class="layout" :style="{ '--sidebar-width': sidebarCollapsed ? '60px' : '220px' }">
      <!-- 侧边栏 -->
      <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
        <div class="sidebar-header">
          <span v-if="!sidebarCollapsed" class="sidebar-brand"><AppIcon name="clock" />Time Tracking</span>
          <span v-else class="sidebar-brand-icon"><AppIcon name="clock" /></span>
        </div>

        <nav class="sidebar-nav">
          <button
            v-for="item in navItems"
            :key="item.key"
            class="nav-item"
            :class="{ active: item.noNav || currentPage === item.key }"
            @click="!item.noNav && (currentPage = item.key)"
            :title="ui(item.label)"
          >
            <span class="nav-icon"><AppIcon :name="item.icon" /></span>
            <span v-if="!sidebarCollapsed" class="nav-label">{{ ui(item.label) }}</span>
          </button>
        </nav>

        <div class="sidebar-footer">
          <LanguagePicker v-if="!sidebarCollapsed" />
          <div v-if="!sidebarCollapsed" class="user-info">
            <div class="user-avatar">{{ (displayName || userName).charAt(0).toUpperCase() }}</div>
            <div class="user-details">
              <div class="user-name">{{ displayName || userName }}</div>
              <div class="user-role">{{ roleLabel }}</div>
            </div>
          </div>
          <button :aria-label="sidebarCollapsed ? ui('展开侧栏') : ui('◀ 收起')" class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed">
            <AppIcon :name="sidebarCollapsed ? 'chevron-right' : 'chevron-left'" /><span v-if="!sidebarCollapsed">{{ ui('◀ 收起') }}</span>
          </button>
          <button v-if="!sidebarCollapsed" class="logout-btn" @click="logout">{{ ui("退出登录") }}</button>
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
              :title="ui(&quot;切换周/日视图&quot;)"
            ><AppIcon name="chevron-down" /></button>
            <button
              class="switch-btn"
              :class="{ active: currentPage === 'week' || currentPage === 'day' }"
              @click="currentPage = calendarMode"
              :title="ui(&quot;日历视图&quot;)"
            >
              <span class="switch-icon"><AppIcon name="calendar" /></span>
              <span class="switch-label">{{ ui("日历视图") }}</span>
              <span class="switch-sub">({{ calendarMode === 'week' ? ui("周") : ui("日") }})</span>
            </button>
            <div v-if="showCalendarDropdown" class="switch-dropdown">
              <div
                class="dropdown-item"
                :class="{ active: calendarMode === 'week' }"
                @click="calendarMode = 'week'; currentPage = 'week'; showCalendarDropdown = false"
              >
                <span><AppIcon name="calendar" /></span> {{ ui("周视图") }}
              </div>
              <div
                class="dropdown-item"
                :class="{ active: calendarMode === 'day' }"
                @click="calendarMode = 'day'; currentPage = 'day'; showCalendarDropdown = false"
              >
                <span><AppIcon name="calendar" /></span> {{ ui("日视图") }}
              </div>
            </div>
          </div>

          <!-- 列表视图 -->
          <button
            class="switch-btn"
            :class="{ active: currentPage === 'list' }"
            @click="currentPage = 'list'"
            :title="ui(&quot;列表视图&quot;)"
          >
            <span class="switch-icon"><AppIcon name="list" /></span>
            <span class="switch-label">{{ ui("列表视图") }}</span>
          </button>
        </div>

        <div v-if="dataError" class="data-error" role="alert">{{ ui("工时加载失败：") }}{{ ui(dataError) }} <button @click="retryEntries">{{ ui("重试") }}</button></div>
        <div v-else-if="dataLoading" class="data-loading" role="status">{{ ui("正在同步工时…") }}</div>
        <!-- 仪表盘页 -->
        <Dashboard v-if="currentPage === 'dashboard'" />
        <!-- 报表页 -->
        <Reports v-else-if="currentPage === 'reports'" />
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
import LanguagePicker from './components/LanguagePicker.vue'
import { configureContentTranslation, resetContentTranslations } from './lib/content-translation.js'
import { ui, locale, setLang, countryName, countryMatches, localDate } from './i18n.js'
import { useContentTranslation } from './lib/content-translation.js'
const { tr, translationVersion } = useContentTranslation()
import { ref, computed, onMounted, onUnmounted, provide, watch, defineAsyncComponent } from 'vue'
import { createHttp } from './lib/http.js'
import { createEntryStore } from './lib/entries.js'
import { createTimer } from './lib/timer.js'
import { readJSON } from './lib/storage.js'
const WeekView = defineAsyncComponent(() => import('./views/WeekView.vue'))
const ListView = defineAsyncComponent(() => import('./views/ListView.vue'))
const DayView = defineAsyncComponent(() => import('./views/DayView.vue'))
const Settings = defineAsyncComponent(() => import('./views/Settings.vue'))
const Dashboard = defineAsyncComponent(() => import('./views/Dashboard.vue'))
const Reports = defineAsyncComponent(() => import('./views/Reports.vue'))

// ───── HTTP 工具 ─────
const API_BASE = import.meta.env.VITE_API_BASE || 'https://1473537498-ejcp1i6ib6.ap-shanghai.tencentscf.com'
const http = createHttp({ base: API_BASE, message: ui })
const translationHttp = createHttp({ base: API_BASE, timeout: 90000 })
configureContentTranslation(async (text, to) => {
  const result = await translationHttp('/translate', { method: 'POST', body: { text, from: 'auto', to } })
  return result.text
})
const entryStore = createEntryStore(http)
const dataError = entryStore.error
const dataLoading = entryStore.loading
provide('entryStore', entryStore)
const clockNow = ref(Date.now())
provide('clockNow', clockNow)
let clockInterval
onMounted(() => { clockInterval = setInterval(() => { clockNow.value = Date.now() }, 60000) })
onUnmounted(() => clearInterval(clockInterval))
function onAuthExpired() { clearSession(); loginError.value = ui('登录已失效，请重新登录') }
onMounted(() => window.addEventListener('auth-expired', onAuthExpired))
onUnmounted(() => window.removeEventListener('auth-expired', onAuthExpired))
async function retryEntries() { try { http.clear(); await entryStore.load({force:true}) } catch {} }

// ───── 登录状态 ─────
const userName = ref('')
const userRole = ref('')
const displayName = ref(localStorage.getItem('tt_display_name') || '')
const userTeam = ref(localStorage.getItem('tt_team') || '')
const feishuUserId = ref(localStorage.getItem('tt_feishu_id') || '')
const showLogin = ref(!userName.value)
const authLoading = ref(false)

// ───── 飞书 H5 免登 ─────
// 飞书企业自建应用 App ID (cli_aa07f5b29ef89bd1)
const FEISHU_H5_APP_ID = 'cli_aa07f5b29ef89bd1'

// 跳转到飞书授权页(用户点"飞书一键登录"时调用)
// 飞书 v2 oauth2 全流程:
//   授权端点: https://accounts.feishu.cn/open-apis/authen/v1/authorize
//   换token:  https://open.feishu.cn/open-apis/authen/v2/oauth/token (SCF后端)
async function redirectToFeishuAuth(action = 'login') {
  if (authLoading.value) return
  authLoading.value = true
  try {
    const res = await http('/auth/feishu/start', {method:'POST', body:{redirect_uri:window.location.origin + window.location.pathname, action:typeof action === 'string' ? action : 'login'}})
    sessionStorage.setItem('tt_oauth_state', res.state)
    window.location.assign(res.url)
  } catch(e) { loginError.value = e.message; alert(e.message); authLoading.value = false }
}
function applySession(res) {
  if (res.session_token) localStorage.setItem('tt_session', res.session_token)
  userName.value = res.user
  userRole.value = res.role
  displayName.value = res.display_name || res.user
  userTeam.value = res.team || ''
  feishuUserId.value = res.feishu_user_id || ''
  for(const [key,value] of Object.entries({tt_user:userName.value,tt_role:userRole.value,tt_display_name:displayName.value,tt_team:userTeam.value,tt_feishu_id:feishuUserId.value}))localStorage.setItem(key,value)
  showLogin.value = false
}
async function tryFeishuAuth() {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code'), state = url.searchParams.get('state')
  if (!code && !url.searchParams.has('error')) return false
  const expected = sessionStorage.getItem('tt_oauth_state')
  sessionStorage.removeItem('tt_oauth_state')
  for(const key of ['code','state','error','error_description'])url.searchParams.delete(key)
  window.history.replaceState({},'',url.toString())
  authLoading.value = true
  try {
    if (!code || !state || state !== expected) throw Error(ui('飞书登录未完成，请重新点击登录'))
    const res = await http('/feishu-auth', {method:'POST', body:{code,state}})
    if (!res.ok) throw Error(res.error || ui('飞书账号未绑定，请先使用账号密码登录并在设置中绑定'))
    applySession(res)
    return true
  } catch(e) { loginError.value = e.message; return false }
  finally { authLoading.value = false }
}

const isAdmin = computed(() => userRole.value === 'admin')

// 角色标签
const roleLabel = computed(() => {
  const r = userRole.value
  if (r === 'admin') return ui("管理员")
  if (r === 'team_admin') return ui("团队管理员")
  if (r === 'member') return ui("团队成员")
  return ui("员工")
})

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
  if (authLoading.value) return
  loginError.value = ''
  const u = loginUser.value.trim()
  const p = loginPass.value
  if (!u || !p) { loginError.value = ui("用户名和密码必填"); return }
  authLoading.value = true
  try {
    const res = await http('/login', { method: 'POST', body: { username: u, password: p } })
    if (!res.ok) { loginError.value = res.error || ui("登录失败"); return }
    if (res.session_token) localStorage.setItem('tt_session', res.session_token)
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
  if (authLoading.value) return
  regError.value = ''
  const invite = regInvite.value.trim()
  const u = regUser.value.trim()
  const dn = regDisplayName.value.trim()
  const p = regPass.value
  const p2 = regPass2.value
  if (!invite || !u || !p || !p2) { regError.value = ui("所有字段都必填"); return }
  if (p.length < 12 || p.length > 256) { regError.value = ui("新密码需为 12 至 256 位"); return }
  if (p !== p2) { regError.value = ui("两次密码不一致"); return }
  authLoading.value = true
  try {
    const res = await http('/register', { method: 'POST', body: { invite_code: invite, username: u, password: p, display_name: dn } })
    if (!res.ok) { regError.value = res.error || ui("注册失败"); return }
    // 注册成功，自动登录
    if (res.session_token) localStorage.setItem('tt_session', res.session_token)
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
  if (!confirm(ui("确定退出登录？"))) return
  clearSession()
}
function clearSession() {
  localStorage.removeItem('tt_session')
  sessionStorage.setItem('tt_feishu_auto', '1')
  timer.reset()
  entryStore.clear()
  http.clear()
  userTeam.value = ''
  feishuUserId.value = ''
  for (const key of ['tt_team', 'tt_feishu_id', 'tt_active_timer', 'tt_entries_cache', 'tt_all_categories']) localStorage.removeItem(key)
  document.cookie = 'tt_timer=; max-age=0; path=/'
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
const savedPage = localStorage.getItem('tt_current_page')
const currentPage = ref(['week', 'day', 'list', 'dashboard', 'reports', 'settings'].includes(savedPage) ? savedPage : 'week')
// 顶部横栏: 日历视图的当前模式 (week/day)
const calendarMode = ref(localStorage.getItem('tt_calendar_mode') === 'day' ? 'day' : 'week')
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
watch(currentPage, (v) => {
  localStorage.setItem('tt_current_page', v)
  if (v === 'week' || v === 'day') calendarMode.value = v
})
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
    { key: isView ? currentPage.value : 'week', icon: 'grid', label: '视图', noNav: isView },
    { key: 'dashboard', icon: 'chart', label: '仪表盘' },
    { key: 'reports', icon: 'report', label: '报表' },
    { key: 'settings', icon: 'settings', label: '设置' },
  ]
})

// ───── 分类管理（全局共享，存 localStorage）─────
const defaultCategories = [
  { name: '工签', color: '#6366f1' },
  { name: '会议', color: '#10b981' },
  { name: '培训', color: '#f59e0b' },
  { name: '其他', color: '#6b7280' },
]
const categories = ref(readJSON('tt_categories', defaultCategories, Array.isArray))

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
const countries = ref(readJSON('tt_countries', defaultCountries, Array.isArray))

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

// 各页面共用计时状态；后台确认成功后才广播停止。
const timer = createTimer({
  http, user: () => userName.value, displayName: () => displayName.value,
  emit: entryStore.timerEvent, message: ui, notify: message => alert(message),
})
const { activeTimer, timerElapsedText, startActiveTimer, stopActiveTimer, restoreActiveTimer } = timer
watch(userName, (next, previous) => {
  resetContentTranslations()
  if (next !== previous) {
    timer.reset()
    entryStore.clear()
    http.clear()
  }
}, { flush: 'sync' })
provide('timerStarting', timer.starting)
provide('timerStopping', timer.stopping)
provide('timerRestoring', timer.restoring)
onUnmounted(timer.reset)

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
provide('userTeam', userTeam)
provide('feishuUserId', feishuUserId)
provide('redirectToFeishuAuth', redirectToFeishuAuth)

// ───── 全局显示姓名开关 (所有视图共享) ─────
const showUserName = ref(localStorage.getItem('tt_show_user_name') === 'true')
watch(showUserName, (v) => localStorage.setItem('tt_show_user_name', String(v)))
provide('showUserName', showUserName)

// ───── onMounted: 自动恢复计时器 ─────
// 刷新页面时, 如果 localStorage 有 tt_user, 会跳过登录直接进主界面
// 但 restoreActiveTimer 只在 confirmLogin 里调用, 刷新时不会触发
// 所以这里要在 onMounted 里主动恢复
onMounted(async () => {
  // 飞书 H5 免登: 检测 URL 是否有 code 参数(飞书重定向回来)
  const hasCallback = new URL(window.location.href).searchParams.has('code') || new URL(window.location.href).searchParams.has('error')
  if (hasCallback) await tryFeishuAuth()
  else if (localStorage.getItem('tt_session')) {
    try { applySession(await http('/auth/me')) } catch(e) { loginError.value = e.message }
  }
  if (!userName.value && !hasCallback && !localStorage.getItem('tt_session') && /Lark|Feishu/i.test(navigator.userAgent) && !sessionStorage.getItem('tt_feishu_auto')) {
    sessionStorage.setItem('tt_feishu_auto','1')
    await redirectToFeishuAuth()
  }
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

/* ── 全局 select: 放大倒三角箭头 ── */
select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><path d='M7 11l7 7 7-7' stroke='%2300d4ff' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 28px 28px;
  padding-right: 40px;
  font-size: 15px;
  font-weight: 600;
}

:root {
  color-scheme: dark;
  /* ── 暗色调科技感配色 ── */
  --primary: #00d4ff;
  --primary-light: #00d4ff;
  --primary-dark: #0099cc;
  --primary-glow: rgba(0, 212, 255, 0.4);
  --bg: #0a0e1a;
  --bg-gradient: linear-gradient(135deg, #0a0e1a 0%, #0f1729 50%, #0a0e1a 100%);
  --surface: #131826;
  --surface-light: #1a2138;
  --surface-hover: #1e2940;
  --text: #e2e8f0;
  --text-secondary: #64748b;
  --text-muted: #475569;
  --border: #1e293b;
  --border-light: #2a3650;
  --success: #00ff88;
  --warning: #ffaa00;
  --danger: #ff3366;
  --radius: 8px;
  --radius-lg: 12px;
  --shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 20px rgba(0, 212, 255, 0.15);
  --sidebar-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
  --sidebar-width: 220px;
  --sidebar-collapsed: 60px;
}

:root[data-theme='light'] {
  color-scheme: light;
  --primary: #007da3;
  --primary-light: #007da3;
  --primary-dark: #006583;
  --primary-glow: rgba(0, 125, 163, 0.12);
  --bg: #f5f7fb;
  --bg-gradient: linear-gradient(135deg, #f5f7fb 0%, #eef3f9 50%, #f5f7fb 100%);
  --surface: #ffffff;
  --surface-light: #f0f4f9;
  --surface-hover: #e5edf5;
  --text: #1e293b;
  --text-secondary: #526277;
  --text-muted: #64748b;
  --border: #dce3ed;
  --border-light: #c5d0df;
  --success: #15803d;
  --warning: #a65a00;
  --danger: #d1224b;
  --shadow: 0 4px 12px rgba(30, 41, 59, 0.06);
  --shadow-lg: 0 8px 24px rgba(30, 41, 59, 0.1);
  --shadow-glow: 0 0 20px rgba(0, 125, 163, 0.08);
  --sidebar-shadow: 4px 0 24px rgba(30, 41, 59, 0.06);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg-gradient);
  background-attachment: fixed;
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
  background: var(--bg-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.auth-card {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 40px;
  width: 400px;
  max-width: 90vw;
  box-shadow: var(--shadow-lg), 0 0 40px rgba(0, 212, 255, 0.1);
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
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  font-size: 14px;
  background: var(--bg);
  color: var(--text);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.auth-field input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
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
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
  color: var(--bg);
  border: none;
  border-radius: var(--radius);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px var(--primary-glow);
  letter-spacing: 0.5px;
}

.auth-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px var(--primary-glow);
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
  box-shadow: var(--sidebar-shadow);
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed);
}

.sidebar-header {
  padding: 20px 16px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-light) 0%, var(--surface) 100%);
}

.sidebar-brand {
  font-size: 16px;
  font-weight: 600;
  color: var(--primary);
  text-shadow: 0 0 12px var(--primary-glow);
  letter-spacing: 0.5px;
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
  background: var(--surface-hover);
  color: var(--primary);
}

.nav-item.active {
  background: linear-gradient(90deg, rgba(0, 212, 255, 0.15) 0%, rgba(0, 212, 255, 0.05) 100%);
  color: var(--primary);
  font-weight: 500;
  box-shadow: inset 3px 0 0 var(--primary);
  text-shadow: 0 0 8px var(--primary-glow);
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
  border: 1px solid var(--border-light);
  background: var(--surface-light);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.collapse-btn:hover {
  background: var(--surface-hover);
  color: var(--primary);
}

.logout-btn {
  padding: 8px 12px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--danger);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  border-radius: var(--radius);
  transition: all 0.15s;
}

.logout-btn:hover {
  background: rgba(255, 51, 102, 0.1);
  border-color: rgba(255, 51, 102, 0.3);
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
  background: var(--surface);
  box-shadow: 0 1px 0 var(--border), 0 4px 12px rgba(0, 0, 0, 0.3);
  height: 48px;
  box-sizing: border-box;
  backdrop-filter: blur(8px);
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
.switch-btn:hover { color: var(--primary); background: var(--surface-hover); }
.switch-btn.active {
  background: var(--surface-light);
  color: var(--primary);
  font-weight: 500;
  box-shadow: 0 0 12px var(--primary-glow), inset 0 0 0 1px var(--border-light);
}
.switch-icon { font-size: 14px; }
.switch-sub { font-size: 11px; color: var(--text-secondary); font-weight: 400; }
.switch-btn.active .switch-sub { color: var(--primary); }
.switch-arrow {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  color: var(--primary);
  transition: all 0.15s;
}
.switch-arrow:hover { color: var(--primary); background: rgba(0, 212, 255, 0.1); text-shadow: 0 0 8px var(--primary-glow); }
.switch-arrow.open { color: var(--primary); text-shadow: 0 0 8px var(--primary-glow); }
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
