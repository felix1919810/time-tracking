<template>
  <div class="settings-view">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <div class="page-title">设置</div>
        <div class="page-subtitle">{{ displayName }} · {{ roleLabel }}</div>
      </div>
    </div>

    <!-- 个人信息 -->
    <div class="settings-section">
      <div class="section-title">个人信息</div>
      <div class="section-body">
        <div class="form-field">
          <label>登录用户名</label>
          <input :value="userName" disabled />
        </div>
        <div class="form-field">
          <label>姓名 <span class="required">*</span></label>
          <input v-model="profileForm.displayName" placeholder="填入工时表的姓名" />
        </div>
        <button class="btn btn-primary" @click="saveProfile" :disabled="!profileForm.displayName || profileForm.displayName === displayName">
          {{ profileLoading ? '保存中...' : '保存姓名' }}
        </button>
      </div>
    </div>

    <!-- 修改密码 -->
    <div class="settings-section">
      <div class="section-title">修改密码</div>
      <div class="section-body">
        <div class="form-field">
          <label>原密码 <span class="required">*</span></label>
          <input type="password" v-model="passwordForm.oldPassword" placeholder="当前密码" />
        </div>
        <div class="form-field">
          <label>新密码 <span class="required">*</span></label>
          <input type="password" v-model="passwordForm.newPassword" placeholder="新密码" />
        </div>
        <div class="form-field">
          <label>确认新密码 <span class="required">*</span></label>
          <input type="password" v-model="passwordForm.confirmPassword" placeholder="再输入一遍新密码" @keyup.enter="changePassword" />
        </div>
        <div v-if="passwordError" class="error-msg">{{ passwordError }}</div>
        <div v-if="passwordSuccess" class="success-msg">{{ passwordSuccess }}</div>
        <button class="btn btn-primary" @click="changePassword" :disabled="!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword || passwordLoading">
          {{ passwordLoading ? '修改中...' : '修改密码' }}
        </button>
      </div>
    </div>

    <!-- 团队管理 (只有管理员可见) -->
    <div v-if="userRole === 'admin'" class="settings-section">
      <div class="section-title">团队管理</div>
      <div class="section-body">
        <p class="section-hint">创建团队、分配成员到团队。每个团队有独立的任务分类。</p>

        <!-- 创建团队 -->
        <div class="add-cat-form" style="margin-bottom:16px;">
          <input v-model="newTeamName" placeholder="新团队名称" class="add-cat-input" @keyup.enter="addTeam" />
          <input v-model="newTeamDesc" placeholder="团队描述(可选)" class="add-cat-input" style="flex:1.5;" />
          <button class="btn btn-secondary" @click="addTeam" :disabled="!newTeamName.trim() || teamLoading">
            {{ teamLoading ? '添加中...' : '创建团队' }}
          </button>
        </div>

        <!-- 团队列表 + 成员分配 -->
        <div v-for="t in teams" :key="t.record_id" class="team-block">
          <div class="team-header">
            <div>
              <div class="team-name">{{ t.name }}</div>
              <div v-if="t.description" class="team-desc">{{ t.description }}</div>
            </div>
            <button class="btn-icon danger" @click="removeTeam(t)" title="删除团队">×</button>
          </div>

          <!-- 该团队的成员列表 -->
          <div class="team-members">
            <div class="members-title">团队成员</div>
            <div v-for="m in membersInTeam(t.name)" :key="m.record_id" class="member-row">
              <span class="member-name">{{ m.display_name }}</span>
              <select :value="m.role" @change="assignMember(m.record_id, t.name, $event.target.value)" class="member-select">
                <option value="member">成员</option>
                <option value="team_admin">团队管理员</option>
              </select>
              <button class="btn-icon danger" @click="removeMemberFromTeam(m)" title="移出团队">×</button>
            </div>
            <div v-if="membersInTeam(t.name).length === 0" class="empty-hint">
              该团队暂无成员，从下方"未分配成员"点击加入
            </div>
          </div>

          <!-- 未分配成员 (可点击加入该团队) -->
          <div class="unassigned-members">
            <div class="members-title">未分配成员 (点击加入该团队)</div>
            <div class="member-chips">
              <span
                v-for="m in unassignedMembers"
                :key="m.record_id"
                class="member-chip"
                @click="assignMember(m.record_id, t.name, 'member')"
              >
                {{ m.display_name }} +
              </span>
              <span v-if="unassignedMembers.length === 0" class="empty-hint">所有成员都已分配团队</span>
            </div>
          </div>
        </div>
        <div v-if="teams.length === 0" class="empty-hint">暂无团队, 请在上方创建</div>
      </div>
    </div>

    <!-- 分类管理 -->
    <div class="settings-section">
      <div class="section-title">
        任务分类管理
        <span class="team-badge">团队: {{ userRole === 'admin' ? (selectedTeamForCategory || '未选择') : (currentTeam || '未分配') }}</span>
      </div>
      <div class="section-body">
        <!-- 团队选择器: 只有管理员可选任意团队, 团队管理员/成员锁定自己团队 -->
        <div v-if="userRole === 'admin'" class="form-field" style="margin-bottom:12px;">
          <label>选择团队</label>
          <select v-model="selectedTeamForCategory" @change="onTeamChange" class="team-select">
            <option v-for="t in availableTeamsForCategory" :key="t.name" :value="t.name">
              {{ t.name }}
            </option>
          </select>
        </div>

        <p class="section-hint">
          <template v-if="userRole === 'admin'">管理员可编辑任意团队的分类。</template>
          <template v-else-if="userRole === 'team_admin'">团队管理员可编辑自己团队的分类。</template>
          <template v-else>团队成员只能查看自己团队的分类, 如需修改请联系团队管理员。</template>
        </p>

        <div v-if="!selectedTeamForCategory && userRole === 'admin'" class="readonly-hint">
          请先在上方选择一个团队。
        </div>

        <div v-else>
          <div class="cat-list">
            <div v-for="cat in teamCategories" :key="cat.record_id || cat.name" class="cat-row">
              <div class="cat-color-wrap">
                <input type="color" v-model="cat.color" @change="updateCategoryColor(cat)" class="cat-color-input" :disabled="!canManageCategories" />
                <span class="cat-color-dot" :style="{ background: cat.color }"></span>
              </div>
              <input v-model="cat.name" @change="onCatRename(cat)" class="cat-name-input" :disabled="cat.name === '其他' || !canManageCategories" />
              <button v-if="cat.name !== '其他' && canManageCategories" class="btn-icon danger" @click="removeCategory(cat)" title="删除">
                ×
              </button>
              <span v-else-if="cat.name === '其他'" class="cat-default-tag">默认</span>
            </div>
          </div>

          <div v-if="canManageCategories" class="add-cat-form">
            <input v-model="newCatName" placeholder="新分类名称" class="add-cat-input" @keyup.enter="addCategory" />
            <input type="color" v-model="newCatColor" class="cat-color-input" />
            <button class="btn btn-secondary" @click="addCategory" :disabled="!newCatName.trim() || catLoading">
              {{ catLoading ? '添加中...' : '添加' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue'

const http = inject('http')
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
  if (r === 'admin') return '管理员'
  if (r === 'team_admin') return '团队管理员'
  return '团队成员'
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
    alert('请先选择团队')
    return
  }
  if (teamCategories.value.find(c => c.name === name)) {
    alert('该分类已存在')
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
    alert('添加分类失败: ' + e.message)
  } finally {
    catLoading.value = false
  }
}

async function removeCategory(cat) {
  if (cat.name === '其他') return
  if (!confirm(`确定删除分类"${cat.name}"？已使用此分类的条目不会受影响。`)) return
  try {
    await http(`/categories/${cat.record_id}`, { method: 'DELETE' })
    teamCategories.value = teamCategories.value.filter(c => c.record_id !== cat.record_id)
  } catch (e) {
    alert('删除分类失败: ' + e.message)
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
    alert('更新颜色失败: ' + e.message)
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
    alert('重命名失败: ' + e.message)
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
      alert('姓名已更新')
    } else {
      alert('保存失败: ' + (res.error || '未知错误'))
    }
  } catch (e) {
    alert('保存失败: ' + e.message)
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
    passwordError.value = '所有字段都必填'
    return
  }
  if (newPassword !== confirmPassword) {
    passwordError.value = '两次新密码不一致'
    return
  }
  if (newPassword.length < 4) {
    passwordError.value = '新密码至少 4 位'
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
      passwordSuccess.value = '密码修改成功 ✓'
      passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
      setTimeout(() => { passwordSuccess.value = '' }, 3000)
    } else {
      passwordError.value = res.error || '修改失败'
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
    alert('该团队已存在')
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
    alert('创建团队失败: ' + e.message)
  } finally {
    teamLoading.value = false
  }
}

async function removeTeam(t) {
  if (!confirm(`确定删除团队"${t.name}"？该团队的成员会变成"未分配"。`)) return
  try {
    await http(`/teams/${t.record_id}`, { method: 'DELETE' })
    teams.value = teams.value.filter(x => x.record_id !== t.record_id)
    // 刷新成员列表(被删团队的成员会变成未分配)
    await loadAllMembers()
  } catch (e) {
    alert('删除团队失败: ' + e.message)
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
    alert('分配成员失败: ' + e.message)
  }
}

// 把成员移出团队 (team 设为空)
async function removeMemberFromTeam(m) {
  if (!confirm(`确定把"${m.display_name}"移出团队？`)) return
  try {
    await http('/teams/members', {
      method: 'POST',
      body: { record_id: m.record_id, team: '', role: m.role },
    })
    m.team = ''
  } catch (e) {
    alert('移出团队失败: ' + e.message)
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

.settings-section {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 24px;
  margin-bottom: 16px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text);
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
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-field input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.form-field input:disabled {
  background: var(--bg);
  color: var(--text-secondary);
}

.error-msg {
  background: #fef2f2;
  color: var(--danger);
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 13px;
}

.success-msg {
  background: #ecfdf5;
  color: var(--success);
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 13px;
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
  background: var(--bg);
  border-radius: 6px;
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
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 14px;
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
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
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
  background: var(--bg);
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
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--bg);
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
  color: var(--text-primary);
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
}

.member-name {
  flex: 1;
  font-size: 14px;
}

.member-select {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
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
  background: white;
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.member-chip:hover {
  background: #6366f1;
  color: white;
  border-color: #6366f1;
}
</style>
