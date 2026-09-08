<template>
  <div class="settings-view">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <div class="page-title">{{ ui("设置") }}</div>
        <div class="page-subtitle">{{ displayName }} · {{ roleLabel }}</div>
      </div>
    </div>

    <section class="settings-section">
      <div class="section-title">{{ ui('飞书账号') }}</div>
      <div class="section-body"><p>{{ feishuUserId ? ui('已绑定飞书账号') : ui('绑定后可使用飞书登录，保留现有历史记录') }}</p>
        <button class="btn btn-primary" @click="redirectToFeishuAuth('bind')">{{ feishuUserId ? ui('重新验证并绑定飞书') : ui('绑定飞书账号') }}</button>
      </div>
    </section>
    <section class="settings-section" aria-labelledby="language-title">
      <div id="language-title" class="section-title">{{ ui('语言') }}</div>
      <div class="section-body">
        <LanguagePicker />
        <p class="section-hint">{{ ui('界面和国家名称即时切换。任务分类、标题和备注由百度翻译，原始记录保持不变。') }}</p>
        <label class="original-toggle"><input type="checkbox" v-model="showOriginal" /> {{ ui('显示任务内容原文') }}</label>
        <p class="section-hint">{{ ui('翻译暂不可用时显示原文；编辑时始终使用原文。') }}</p>
      </div>
    </section>
    <section class="settings-section" aria-labelledby="appearance-title">
      <div id="appearance-title" class="section-title">{{ ui("外观") }}</div>
      <div class="section-body">
        <p id="theme-hint" class="section-hint">{{ ui("选择页面配色，立即生效并自动保存在当前浏览器。") }}</p>
        <div class="theme-options" role="radiogroup" :aria-label="ui(&quot;页面主题&quot;)" aria-describedby="theme-hint">
          <label v-for="option in themeOptions" :key="option.value" class="theme-option" :class="{ selected: theme === option.value }">
            <input type="radio" name="theme" :value="option.value" :checked="theme === option.value" @change="setTheme(option.value)" />
            <span class="theme-preview" :class="option.value" aria-hidden="true"><span></span></span>
            <span class="theme-label">{{ ui(option.label) }}</span>
          </label>
        </div>
      </div>
    </section>

    <!-- 个人信息 -->
    <div class="settings-section">
      <div class="section-title">{{ ui("个人信息") }}</div>
      <div class="section-body">
        <div class="form-field">
          <label>{{ ui("登录用户名") }}</label>
          <input :value="userName" disabled />
        </div>
        <div class="form-field">
          <label>{{ ui("姓名") }} <span class="required">*</span></label>
          <input v-model="profileForm.displayName" :placeholder="ui(&quot;填入工时表的姓名&quot;)" />
        </div>
        <button class="btn btn-primary" @click="saveProfile" :disabled="!profileForm.displayName || profileForm.displayName === displayName">
          {{ profileLoading ? ui("保存中...") : ui("保存姓名") }}
        </button>
      </div>
    </div>

    <!-- 修改密码 -->
    <div class="settings-section">
      <div class="section-title">{{ ui("修改密码") }}</div>
      <div class="section-body">
        <div class="form-field">
          <label>{{ ui("原密码") }} <span class="required">*</span></label>
          <input type="password" v-model="passwordForm.oldPassword" :placeholder="ui(&quot;当前密码&quot;)" />
        </div>
        <div class="form-field">
          <label>{{ ui("新密码") }} <span class="required">*</span></label>
          <input type="password" v-model="passwordForm.newPassword" :placeholder="ui(&quot;新密码&quot;)" />
        </div>
        <div class="form-field">
          <label>{{ ui("确认新密码") }} <span class="required">*</span></label>
          <input type="password" v-model="passwordForm.confirmPassword" :placeholder="ui(&quot;再输入一遍新密码&quot;)" @keyup.enter="changePassword" />
        </div>
        <div v-if="passwordError" class="error-msg">{{ passwordError }}</div>
        <div v-if="passwordSuccess" class="success-msg">{{ passwordSuccess }}</div>
        <button class="btn btn-primary" @click="changePassword" :disabled="!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword || passwordLoading">
          {{ passwordLoading ? ui("修改中...") : ui("修改密码") }}
        </button>
      </div>
    </div>

    <!-- 团队管理 (只有管理员可见) -->
    <div v-if="userRole === 'admin'" class="settings-section">
      <div class="section-title">{{ ui("团队管理") }}</div>
      <div class="section-body">
        <p class="section-hint">{{ ui("创建团队、分配成员到团队。每个团队有独立的任务分类。") }}</p>

        <!-- 创建团队 -->
        <div class="add-cat-form" style="margin-bottom:16px;">
          <input v-model="newTeamName" :placeholder="ui(&quot;新团队名称&quot;)" class="add-cat-input" @keyup.enter="addTeam" />
          <input v-model="newTeamDesc" :placeholder="ui(&quot;团队描述(可选)&quot;)" class="add-cat-input" style="flex:1.5;" />
          <button class="btn btn-secondary" @click="addTeam" :disabled="!newTeamName.trim() || teamLoading">
            {{ teamLoading ? ui("添加中...") : ui("创建团队") }}
          </button>
        </div>

        <!-- 团队列表 + 成员分配 -->
        <div v-for="t in teams" :key="t.record_id" class="team-block">
          <div class="team-header">
            <div>
              <div class="team-name">{{ t.name }}</div>
              <div v-if="t.description" class="team-desc">{{ t.description }}</div>
            </div>
            <button class="btn-icon danger" @click="removeTeam(t)" :title="ui(&quot;删除团队&quot;)"><AppIcon name="close" /></button>
          </div>

          <!-- 该团队的成员列表 -->
          <div class="team-members">
            <div class="members-title">{{ ui("团队成员") }}</div>
            <div v-for="m in membersInTeam(t.name)" :key="m.record_id" class="member-row">
              <span class="member-name">{{ m.display_name }}</span>
              <select :value="m.role" @change="assignMember(m.record_id, t.name, $event.target.value)" class="member-select">
                <option value="member">{{ ui("成员") }}</option>
                <option value="team_admin">{{ ui("团队管理员") }}</option>
              </select>
              <button class="btn-icon danger" @click="removeMemberFromTeam(m)" :title="ui(&quot;移出团队&quot;)"><AppIcon name="close" /></button>
            </div>
            <div v-if="membersInTeam(t.name).length === 0" class="empty-hint">
              {{ ui("该团队暂无成员，从下方\"未分配成员\"点击加入") }}
            </div>
          </div>

          <!-- 未分配成员 (可点击加入该团队) -->
          <div class="unassigned-members">
            <div class="members-title">{{ ui("未分配成员 (点击加入该团队)") }}</div>
            <div class="member-chips">
              <span
                v-for="m in unassignedMembers"
                :key="m.record_id"
                class="member-chip"
                @click="assignMember(m.record_id, t.name, 'member')"
              >
                {{ m.display_name }} +
              </span>
              <span v-if="unassignedMembers.length === 0" class="empty-hint">{{ ui("所有成员都已分配团队") }}</span>
            </div>
          </div>
        </div>
        <div v-if="teams.length === 0" class="empty-hint">{{ ui("暂无团队, 请在上方创建") }}</div>
      </div>
    </div>

    <!-- 分类管理 -->
    <div class="settings-section">
      <div class="section-title">
        {{ ui("任务分类管理") }}
        <span class="team-badge">{{ ui("团队:") }} {{ userRole === 'admin' ? (selectedTeamForCategory || ui("未选择")) : (currentTeam || ui("未分配")) }}</span>
      </div>
      <div class="section-body">
        <!-- 团队选择器: 只有管理员可选任意团队, 团队管理员/成员锁定自己团队 -->
        <div v-if="userRole === 'admin'" class="form-field" style="margin-bottom:12px;">
          <label>{{ ui("选择团队") }}</label>
          <select v-model="selectedTeamForCategory" @change="onTeamChange" class="team-select">
            <option v-for="t in availableTeamsForCategory" :key="t.name" :value="t.name">
              {{ t.name }}
            </option>
          </select>
        </div>

        <p class="section-hint">
          <template v-if="userRole === 'admin'">{{ ui("管理员可编辑任意团队的分类。") }}</template>
          <template v-else-if="userRole === 'team_admin'">{{ ui("团队管理员可编辑自己团队的分类。") }}</template>
          <template v-else>{{ ui("团队成员只能查看自己团队的分类, 如需修改请联系团队管理员。") }}</template>
        </p>

        <div v-if="!selectedTeamForCategory && userRole === 'admin'" class="readonly-hint">
          {{ ui("请先在上方选择一个团队。") }}
        </div>

        <div v-else>
          <div class="cat-list">
            <div v-for="cat in teamCategories" :key="cat.record_id || cat.name" class="cat-row">
              <div class="cat-color-wrap">
                <input type="color" v-model="cat.color" @change="updateCategoryColor(cat)" class="cat-color-input" :disabled="!canManageCategories" />
                <span class="cat-color-dot" :style="{ background: cat.color }"></span>
              </div>
              <div class="category-editor">
                <input v-if="canManageCategories && cat.name !== '其他'" v-model.lazy="cat.name" @change="onCatRename(cat)" class="cat-name-input" :aria-label="ui('分类原文')" />
                <span v-else class="cat-name-input">{{ tr(cat.name) }}</span>
                <small v-if="canManageCategories && cat.name !== '其他' && tr(cat.name) !== cat.name">{{ tr(cat.name) }}</small>
              </div>
              <button v-if="cat.name !== '其他' && canManageCategories" class="btn-icon danger" @click="removeCategory(cat)" :title="ui(&quot;删除&quot;)">
                ×
              </button>
              <span v-else-if="cat.name === '其他'" class="cat-default-tag">{{ ui("默认") }}</span>
            </div>
          </div>

          <div v-if="canManageCategories" class="add-cat-form">
            <input v-model="newCatName" :placeholder="ui(&quot;新分类名称&quot;)" class="add-cat-input" @keyup.enter="addCategory" />
            <input type="color" v-model="newCatColor" class="cat-color-input" />
            <button class="btn btn-secondary" @click="addCategory" :disabled="!newCatName.trim() || catLoading">
              {{ catLoading ? ui("添加中...") : ui("添加") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import LanguagePicker from '../components/LanguagePicker.vue'
import { showOriginal } from '../lib/content-translation.js'
import { ui, locale, setLang, countryName, countryMatches, localDate } from '../i18n.js'
import { useContentTranslation } from '../lib/content-translation.js'
const { tr, translationVersion } = useContentTranslation()
import { ref, computed, inject, onMounted } from 'vue'
import { theme, setTheme } from '../lib/theme.js'

const themeOptions = [
  { value: 'dark', label: '深色模式' },
  { value: 'light', label: '浅色模式' },
]

const http = inject('http')
const feishuUserId = inject('feishuUserId')
const redirectToFeishuAuth = inject('redirectToFeishuAuth')
const userName = inject('userName')
const userRole = inject('userRole')
const displayName = inject('displayName')

// ───── 个人信息 ─────
const profileForm = ref({
  displayName: displayName.value || userName.value,
})
const profileLoading = ref(false)

// ───── 权限 ─────
// 只有 team_admin / admin 能管理分类
const canManageCategories = computed(() => {
  const r = userRole.value
  return r === 'team_admin' || r === 'admin'
})
// 角色标签
const roleLabel = computed(() => {
  const r = userRole.value
  if (r === 'admin') return ui("管理员")
  if (r === 'team_admin') return ui("团队管理员")
  return ui("团队成员")
})
// 当前用户所属团队 (从 App.vue inject, 登录时自动更新)
const currentTeam = inject('userTeam')

// ───── 任务分类 (团队独立) ─────
// selectedTeamForCategory: 当前在分类管理里选中的团队
const selectedTeamForCategory = ref('')
// teamCategories: 从飞书分类表读, [{ record_id, name, color, team }]
const teamCategories = ref([])
const newCatName = ref('')
const newCatColor = ref('#6366f1')
const catLoading = ref(false)

// 可选的团队列表 (管理员=全部团队, 团队管理员/成员=自己团队)
const availableTeamsForCategory = computed(() => {
  if (userRole.value === 'admin') return teams.value
  // team_admin / member: 只能选自己团队
  return teams.value.filter(t => t.name === currentTeam.value)
})

// 切换团队时重新加载该团队的分类
function onTeamChange() {
  loadTeamCategories()
}

async function loadTeamCategories() {
  // 用 selectedTeamForCategory 决定加载哪个团队的分类
  const team = selectedTeamForCategory.value || currentTeam.value
  if (!team) {
    teamCategories.value = [{ name: '其他', color: '#6b7280' }]
    return
  }
  try {
    const teamParam = `?team=${encodeURIComponent(team)}`
    const res = await http(`/categories${teamParam}`)
    teamCategories.value = res.items || []
    // 确保"其他"存在
    if (!teamCategories.value.find(c => c.name === '其他')) {
      teamCategories.value.unshift({ name: '其他', color: '#6b7280' })
    }
  } catch (e) {
    console.error('加载分类失败:', e)
    teamCategories.value = [{ name: '其他', color: '#6b7280' }]
  }
}

async function addCategory() {
  const name = newCatName.value.trim()
  if (!name) return
  const team = selectedTeamForCategory.value || currentTeam.value
  if (!team) {
    alert(ui("请先选择团队"))
    return
  }
  if (teamCategories.value.find(c => c.name === name)) {
    alert(ui("该分类已存在"))
    return
  }
  catLoading.value = true
  try {
    const res = await http('/categories', {
      method: 'POST',
      body: {
        team: team,
        name,
        color: newCatColor.value,
      },
    })
    teamCategories.value.push({
      record_id: res.record_id,
      name: res.name,
      color: res.color,
      team: team,
    })
    newCatName.value = ''
    newCatColor.value = '#6366f1'
  } catch (e) {
    alert(ui("添加分类失败: ") + e.message)
  } finally {
    catLoading.value = false
  }
}

async function removeCategory(cat) {
  if (cat.name === '其他') return
  if (!confirm(ui("确定删除分类\"{0}\"？已使用此分类的条目不会受影响。", [cat.name]))) return
  try {
    await http(`/categories/${cat.record_id}`, { method: 'DELETE' })
    teamCategories.value = teamCategories.value.filter(c => c.record_id !== cat.record_id)
  } catch (e) {
    alert(ui("删除分类失败: ") + e.message)
  }
}

async function updateCategoryColor(cat) {
  // 直接调 PUT /categories/:id 更新颜色
  if (!cat.record_id) return
  try {
    await http(`/categories/${cat.record_id}`, {
      method: 'PUT',
      body: { color: cat.color },
    })
  } catch (e) {
    alert(ui("更新颜色失败: ") + e.message)
  }
}

async function onCatRename(cat) {
  // 直接调 PUT /categories/:id 更新名称
  if (!cat.record_id || cat.name === '其他') return
  try {
    await http(`/categories/${cat.record_id}`, {
      method: 'PUT',
      body: { name: cat.name },
    })
  } catch (e) {
    alert(ui("重命名失败: ") + e.message)
  }
}

// ───── 个人信息保存 ─────
async function saveProfile() {
  profileLoading.value = true
  try {
    const res = await http('/update-profile', {
      method: 'POST',
      body: {
        username: userName.value,
        display_name: profileForm.value.displayName,
      },
    })
    if (res.ok) {
      displayName.value = res.display_name
      localStorage.setItem('tt_display_name', res.display_name)
      alert(ui("姓名已更新"))
    } else {
      alert(ui("保存失败: ") + (res.error || ui("未知错误")))
    }
  } catch (e) {
    alert(ui("保存失败: ") + e.message)
  } finally {
    profileLoading.value = false
  }
}

// ───── 修改密码 ─────
const passwordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})
const passwordError = ref('')
const passwordSuccess = ref('')
const passwordLoading = ref(false)

async function changePassword() {
  passwordError.value = ''
  passwordSuccess.value = ''

  const { oldPassword, newPassword, confirmPassword } = passwordForm.value
  if (!oldPassword || !newPassword || !confirmPassword) {
    passwordError.value = ui("所有字段都必填")
    return
  }
  if (newPassword !== confirmPassword) {
    passwordError.value = ui("两次新密码不一致")
    return
  }
  if (newPassword.length < 4) {
    passwordError.value = ui("新密码至少 4 位")
    return
  }

  passwordLoading.value = true
  try {
    const res = await http('/change-password', {
      method: 'POST',
      body: {
        username: userName.value,
        old_password: oldPassword,
        new_password: newPassword,
      },
    })
    if (res.ok) {
      passwordSuccess.value = ui("密码修改成功 ✓")
      passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
      setTimeout(() => { passwordSuccess.value = '' }, 3000)
    } else {
      passwordError.value = res.error || ui("修改失败")
    }
  } catch (e) {
    passwordError.value = e.message
  } finally {
    passwordLoading.value = false
  }
}

// ───── 团队管理 (只有管理员可见) ─────
const teams = ref([])
const teamMembersList = ref([])
const newTeamName = ref('')
const newTeamDesc = ref('')
const teamLoading = ref(false)

async function loadTeams() {
  // 所有角色都加载团队列表 (admin=全部, team_admin/member=自己团队由后端控制)
  try {
    const res = await http('/teams')
    teams.value = res.items || []
    // 非管理员: 直接用 currentTeam 加载分类, 不设 selectedTeamForCategory
    if (userRole.value !== 'admin') {
      await loadTeamCategories()
    } else if (userRole.value === 'admin' && !selectedTeamForCategory.value && teams.value.length > 0) {
      // 管理员默认选中第一个团队
      selectedTeamForCategory.value = teams.value[0].name
      await loadTeamCategories()
    }
  } catch (e) {
    console.error('加载团队失败:', e)
  }
}

async function loadAllMembers() {
  if (userRole.value !== 'admin') return
  try {
    const res = await http('/teams/members')
    teamMembersList.value = res.items || []
  } catch (e) {
    console.error('加载成员失败:', e)
  }
}

async function addTeam() {
  const name = newTeamName.value.trim()
  if (!name) return
  if (teams.value.find(t => t.name === name)) {
    alert(ui("该团队已存在"))
    return
  }
  teamLoading.value = true
  try {
    const res = await http('/teams', {
      method: 'POST',
      body: { name, description: newTeamDesc.value },
    })
    teams.value.push({ record_id: res.record_id, name, description: newTeamDesc.value })
    newTeamName.value = ''
    newTeamDesc.value = ''
  } catch (e) {
    alert(ui("创建团队失败: ") + e.message)
  } finally {
    teamLoading.value = false
  }
}

async function removeTeam(t) {
  if (!confirm(ui("确定删除团队\"{0}\"？该团队的成员会变成\"未分配\"。", [t.name]))) return
  try {
    await http(`/teams/${t.record_id}`, { method: 'DELETE' })
    teams.value = teams.value.filter(x => x.record_id !== t.record_id)
    // 刷新成员列表(被删团队的成员会变成未分配)
    await loadAllMembers()
  } catch (e) {
    alert(ui("删除团队失败: ") + e.message)
  }
}

async function assignMember(recordId, team, role) {
  try {
    await http('/teams/members', {
      method: 'POST',
      body: { record_id: recordId, team, role },
    })
    // 更新本地状态
    const m = teamMembersList.value.find(x => x.record_id === recordId)
    if (m) {
      m.team = team
      m.role = role
    }
  } catch (e) {
    alert(ui("分配成员失败: ") + e.message)
  }
}

// 把成员移出团队 (team 设为空)
async function removeMemberFromTeam(m) {
  if (!confirm(ui("确定把\"{0}\"移出团队？", [m.display_name]))) return
  try {
    await http('/teams/members', {
      method: 'POST',
      body: { record_id: m.record_id, team: '', role: m.role },
    })
    m.team = ''
  } catch (e) {
    alert(ui("移出团队失败: ") + e.message)
  }
}

// 某团队的成员列表
function membersInTeam(teamName) {
  return teamMembersList.value.filter(m => m.team === teamName)
}

// 未分配团队的成员 (team 为空)
const unassignedMembers = computed(() => {
  return teamMembersList.value.filter(m => !m.team || m.team === '')
})

// ───── 初始化 ─────
onMounted(() => {
  loadTeams()
  loadAllMembers()
})
</script>

<style scoped>
.settings-view {
  max-width: 720px;
  margin: 0 auto;
}

.page-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.theme-option {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--bg);
  cursor: pointer;
}

.theme-option.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.theme-option:focus-within {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}

.theme-option input { accent-color: var(--primary); }
.theme-label { font-size: 14px; font-weight: 500; }

.theme-preview {
  display: flex;
  flex: 0 0 100%;
  order: -1;
  height: 64px;
  padding: 10px 10px 10px 28px;
  border: 1px solid #2a3650;
  border-radius: 5px;
  background: linear-gradient(90deg, #1a2138 20%, #0a0e1a 20%);
}

.theme-preview span { width: 100%; border-radius: 3px; background: #131826; }
.theme-preview.light { border-color: #c5d0df; background: linear-gradient(90deg, #e5edf5 20%, #f5f7fb 20%); }
.theme-preview.light span { background: #ffffff; }

.settings-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  padding: 24px;
  margin-bottom: 16px;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.settings-section:hover {
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text);
  text-shadow: 0 0 8px var(--primary-glow);
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.form-field {
  margin-bottom: 4px;
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

.form-field input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-field input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}

.form-field input:disabled {
  background: var(--bg);
  color: var(--text-secondary);
  cursor: not-allowed;
}

.error-msg {
  background: rgba(255, 51, 102, 0.1);
  color: var(--danger);
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 13px;
  border: 1px solid var(--danger);
}

.success-msg {
  background: rgba(0, 255, 136, 0.1);
  color: var(--success);
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 13px;
  border: 1px solid var(--success);
}

/* 分类管理 */
.cat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--surface-light);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: box-shadow 0.2s, border-color 0.2s;
}

.cat-row:hover {
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
}

.cat-color-wrap {
  position: relative;
  width: 32px;
  height: 32px;
}

.cat-color-input {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  position: absolute;
}

.cat-color-dot {
  position: absolute;
  top: 0;
  left: 0;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  pointer-events: none;
}

.cat-name-input {
  flex: 1;
  padding: 6px 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.cat-name-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}

.cat-name-input:disabled {
  background: transparent;
  color: var(--text-secondary);
  border-color: transparent;
}

.cat-default-tag {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--surface);
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.add-cat-form {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-cat-input {
  flex: 1;
  padding: 8px 12px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.add-cat-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}

/* 国家管理 */
.country-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.country-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--surface-light);
  border: 1px solid var(--border);
  border-radius: 16px;
  font-size: 13px;
}

.tag-remove {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
}

.tag-remove:hover {
  color: var(--danger);
}

.add-country-form {
  display: flex;
  align-items: center;
  gap: 8px;
}
.team-block {
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  padding: 12px;
  margin-bottom: 12px;
  background: var(--surface-light);
  transition: box-shadow 0.2s, border-color 0.2s;
}

.team-block:hover {
  box-shadow: var(--shadow-glow);
  border-color: var(--primary);
}

.team-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.team-name {
  font-weight: 700;
  font-size: 15px;
  color: var(--text);
  text-shadow: 0 0 8px var(--primary-glow);
}

.team-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.team-members {
  margin-bottom: 10px;
}

.members-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
}

.member-row:last-child {
  border-bottom: none;
}

.member-name {
  flex: 1;
  font-size: 14px;
  color: var(--text);
}

.member-select {
  padding: 2px 6px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  font-size: 12px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.member-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}

.unassigned-members {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.member-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.member-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border-light);
  border-radius: 14px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.member-chip:hover {
  background: var(--surface-hover);
  color: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 0 12px var(--primary-glow);
}

.btn {
  padding: 8px 16px;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid var(--border-light);
  background: var(--surface-light);
  color: var(--text);
}

.btn:hover {
  background: var(--surface-hover);
  color: var(--primary);
  border-color: var(--primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary);
  color: var(--bg);
  border: none;
}

.btn-primary:hover {
  background: var(--primary);
  color: var(--bg);
  box-shadow: 0 0 16px var(--primary-glow);
}

.btn-secondary {
  background: var(--surface-light);
  color: var(--primary);
  border: 1px solid var(--primary);
}

.btn-secondary:hover {
  background: var(--surface-hover);
  color: var(--primary);
  box-shadow: 0 0 12px var(--primary-glow);
}

.btn-icon {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--border-light);
  background: var(--surface-light);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: all 0.15s;
}

.btn-icon:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.btn-icon.danger:hover {
  color: var(--danger);
  border-color: var(--danger);
  box-shadow: 0 0 12px rgba(255, 51, 102, 0.3);
}

.empty-hint {
  color: var(--text-secondary);
  font-size: 13px;
  font-style: italic;
}

.readonly-hint {
  background: var(--surface-light);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}

.team-badge {
  font-size: 12px;
  font-weight: 400;
  color: var(--primary);
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid var(--border-light);
  padding: 2px 10px;
  border-radius: 12px;
  margin-left: 8px;
}

.team-select {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.team-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.15), 0 0 12px var(--primary-glow);
}
</style>
