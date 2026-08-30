<template>
  <div class="report-view">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <div class="page-title">报表</div>
        <div class="page-subtitle">{{ rangeText }} · {{ displayName }} ({{ roleLabel }})</div>
      </div>
      <!-- 切换查看对象: 只有团队管理员和管理员可见 -->
      <div v-if="canViewOthers" class="view-switch" style="margin-right:12px;">
        <label>查看:</label>
        <select v-model="viewScope" @change="loadEntries">
          <option value="self">自己 ({{ displayName }})</option>
          <option v-if="userRole === 'team_admin' || userRole === 'admin'" value="team">本团队全部</option>
          <option v-if="userRole === 'admin'" value="all">全部团队</option>
        </select>
        <select v-if="viewScope !== 'self'" v-model="selectedUser" @change="loadEntries">
          <option value="">(全部成员)</option>
          <option v-for="u in teamMembers" :key="u.user" :value="u.user">{{ u.user }}</option>
        </select>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" @click="downloadTemplate">下载模板</button>
        <button class="btn btn-secondary" @click="showImport = true">导入 Excel</button>
        <button class="btn btn-secondary" @click="exportCSV">导出 CSV</button>
        <button class="btn btn-primary" @click="openNew">+ 新增</button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <div class="range-tabs">
        <button :class="{ active: range === 'day' }" @click="setRange('day')">日</button>
        <button :class="{ active: range === 'week' }" @click="setRange('week')">周</button>
        <button :class="{ active: range === 'month' }" @click="setRange('month')">月</button>
      </div>
      <button class="nav-arrow" @click="shiftRange(-1)">‹</button>
      <span class="range-text">{{ rangeText }}</span>
      <button class="nav-arrow" @click="shiftRange(1)">›</button>
      <span class="total-spacer"></span>
      <span class="total-label">合计：<strong>{{ fmtHM(filteredMin) }}</strong></span>
    </div>

    <!-- 表格 -->
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>开始</th>
            <th>结束</th>
            <th>时长</th>
            <th>任务名</th>
            <th>分类</th>
            <th>姓名</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in filteredEntries" :key="e.record_id">
            <td>{{ fmtDate(e.fields['start_time']) }}</td>
            <td>{{ fmtTime(e.fields['start_time']) }}</td>
            <td>{{ fmtTime(e.fields['end_time']) }}</td>
            <td>{{ fmtHM(entryDur(e)) }}</td>
            <td>{{ e.fields['description'] || '(无描述)' }}</td>
            <td>
              <span class="cat-badge" :style="{ background: (categories.find(c => c.name === (e.fields['category'] || '其他'))?.color || '#6b7280') + '22', color: (categories.find(c => c.name === (e.fields['category'] || '其他'))?.color || '#6b7280') }">
                {{ e.fields['category'] || '其他' }}
              </span>
            </td>
            <td>{{ e.fields['user'] || '-' }}</td>
            <td>{{ e.fields['notes'] || '-' }}</td>
            <td>
              <button class="row-btn" @click="openEdit(e)">编辑</button>
              <button class="row-btn danger" @click="deleteEntry(e)">删除</button>
            </td>
          </tr>
          <tr v-if="filteredEntries.length === 0">
            <td colspan="9" class="empty-row">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showEditModal" class="modal-mask" @click.self="showEditModal = false">
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">{{ editForm.record_id ? '编辑条目' : '新增条目' }}</div>
          <button class="modal-close" @click="showEditModal = false">×</button>
        </div>

        <div class="form-field">
          <label>任务名 <span class="required">*</span></label>
          <input v-model="editForm.description" />
        </div>

        <div class="form-field">
          <label>任务分类 <span class="required">*</span></label>
          <select v-model="editForm.category">
            <option v-for="c in categories" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>开始时间 <span class="required">*</span></label>
            <input type="datetime-local" v-model="editForm.startTime" />
          </div>
          <div class="form-field">
            <label>结束时间 <span class="required">*</span></label>
            <input type="datetime-local" v-model="editForm.endTime" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label>姓名</label>
            <input v-model="editForm.user" />
          </div>
          <div class="form-field">
            <label>国家</label>
            <select v-model="editForm.country">
              <option v-for="c in countries" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
        </div>

        <div class="form-field">
          <label>备注</label>
          <textarea v-model="editForm.notes"></textarea>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showEditModal = false">取消</button>
          <button class="btn btn-primary" @click="saveEntry">保存</button>
        </div>
      </div>
    </div>

    <!-- 导入弹窗 -->
    <div v-if="showImport" class="modal-mask" @click.self="showImport = false">
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">导入 Excel</div>
          <button class="modal-close" @click="showImport = false">×</button>
        </div>

        <div class="import-info">
          <p><strong>导入要求：</strong></p>
          <p>1. 严格按照模板格式填写</p>
          <p>2. 列顺序：任务名 | 任务分类 | 开始时间 | 结束时间 | 姓名 | 国家 | 备注</p>
          <p>3. 时间格式：YYYY-MM-DD HH:MM</p>
          <p>4. 必填字段不能为空</p>
          <p style="margin-top: 12px;">
            <button class="btn btn-secondary" @click="downloadTemplate">下载模板</button>
          </p>
        </div>

        <div class="form-field">
          <label>选择 Excel 文件</label>
          <input type="file" accept=".xlsx,.xls,.csv" @change="handleFileUpload" ref="fileInput" />
        </div>

        <div v-if="importPreview.length > 0" class="import-preview">
          <p>预览：共 {{ importPreview.length }} 条数据</p>
          <div class="preview-list">
            <div v-for="(row, i) in importPreview.slice(0, 5)" :key="i" class="preview-row">
              {{ row.join(' | ') }}
            </div>
            <div v-if="importPreview.length > 5" class="preview-more">... 还有 {{ importPreview.length - 5 }} 条</div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showImport = false">取消</button>
          <button class="btn btn-primary" @click="doImport" :disabled="importPreview.length === 0">
            确认导入 ({{ importPreview.length }} 条)
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, inject } from 'vue'

const http = inject('http')
const userName = inject('userName')
const userRole = inject('userRole')
const displayName = inject('displayName')
const isAdmin = inject('isAdmin')
const categories = inject('categories')
const countries = inject('countries')

const entries = ref([])

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
const range = ref('week') // day | week | month
const rangeOffset = ref(0)

// ───── 范围计算 ─────
const rangeStart = computed(() => {
  const now = new Date()
  if (range.value === 'day') {
    const d = new Date(now)
    d.setDate(now.getDate() + rangeOffset.value)
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (range.value === 'week') {
    const day = now.getDay() || 7
    const d = new Date(now)
    d.setDate(now.getDate() - day + 1 + rangeOffset.value * 7)
    d.setHours(0, 0, 0, 0)
    return d
  }
  // month
  const d = new Date(now.getFullYear(), now.getMonth() + rangeOffset.value, 1)
  return d
})

const rangeEnd = computed(() => {
  const s = new Date(rangeStart.value)
  if (range.value === 'day') s.setDate(s.getDate() + 1)
  else if (range.value === 'week') s.setDate(s.getDate() + 7)
  else s.setMonth(s.getMonth() + 1)
  return s
})

const rangeText = computed(() => {
  const s = rangeStart.value
  const e = new Date(rangeEnd.value)
  e.setDate(e.getDate() - 1)
  if (range.value === 'month') {
    return `${s.getFullYear()}年${s.getMonth() + 1}月`
  }
  return `${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`
})

function setRange(r) {
  range.value = r
  rangeOffset.value = 0
  loadEntries()
}

function shiftRange(n) {
  rangeOffset.value += n
  loadEntries()
}

// ───── 筛选 ─────
const filteredEntries = computed(() => {
  const s = rangeStart.value
  const e = rangeEnd.value
  return entries.value
    .filter(en => {
      const start = new Date(en.fields['start_time'])
      return start >= s && start < e
    })
    .sort((a, b) => new Date(a.fields['start_time']) - new Date(b.fields['start_time']))
})

const filteredMin = computed(() => filteredEntries.value.reduce((sum, e) => sum + entryDur(e), 0))

function entryDur(e) {
  const s = new Date(e.fields['start_time'])
  const en = new Date(e.fields['end_time'])
  return Math.max(0, (en - s) / 60000)
}

function fmtDate(d) {
  const date = new Date(d)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function fmtTime(d) {
  const date = new Date(d)
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}

function fmtHM(min) {
  min = Math.round(min)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// ───── 加载 ─────
async function loadEntries() {
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
  } catch (e) {
    console.error('加载失败:', e)
  }
}

// ───── 新增/编辑 ─────
const showEditModal = ref(false)
const editForm = ref({
  record_id: '',
  description: '',
  category: '工签',
  startTime: '',
  endTime: '',
  user: '',
  country: '中国',
  notes: '',
})

function openNew() {
  const now = new Date()
  editForm.value = {
    record_id: '',
    description: '',
    category: categories.value[0]?.name || '工签',
    startTime: toLocalDatetime(now),
    endTime: toLocalDatetime(new Date(now.getTime() + 3600000)),
    user: displayName.value || userName.value,
    country: '中国',
    notes: '',
  }
  showEditModal.value = true
}

function openEdit(e) {
  const s = new Date(e.fields['start_time'])
  const en = new Date(e.fields['end_time'])
  editForm.value = {
    record_id: e.record_id,
    description: e.fields['description'] || '',
    category: e.fields['category'] || '其他',
    startTime: toLocalDatetime(s),
    endTime: toLocalDatetime(en),
    user: e.fields['user'] || '',
    country: e.fields['country'] || '中国',
    notes: e.fields['notes'] || '',
  }
  showEditModal.value = true
}

function toLocalDatetime(d) {
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}

function fromLocalDatetime(s) {
  return new Date(s).toISOString()
}

async function saveEntry() {
  try {
    const fields = {
      'description': editForm.value.description,
      'category': editForm.value.category,
      'start_time': fromLocalDatetime(editForm.value.startTime),
      'end_time': fromLocalDatetime(editForm.value.endTime),
      'user': editForm.value.user,
      'country': editForm.value.country,
      'notes': editForm.value.notes,
    }
    if (editForm.value.record_id) {
      await http('/entries/' + editForm.value.record_id, { method: 'PUT', body: { fields } })
    } else {
      await http('/entries', { method: 'POST', body: { fields } })
    }
    showEditModal.value = false
    await loadEntries()
  } catch (e) {
    alert('保存失败: ' + e.message)
  }
}

async function deleteEntry(e) {
  if (!confirm('确定删除这条记录？')) return
  try {
    await http('/entries/' + e.record_id, { method: 'DELETE' })
    await loadEntries()
  } catch (e) {
    alert('删除失败: ' + e.message)
  }
}

// ───── 导出 CSV ─────
function exportCSV() {
  const rows = [['日期', '开始', '结束', '时长(分钟)', '任务名', '任务分类', '姓名', '国家', '备注']]
  for (const e of filteredEntries.value) {
    const s = new Date(e.fields['start_time'])
    const en = new Date(e.fields['end_time'])
    rows.push([
      s.toISOString().slice(0, 10),
      fmtTime(s),
      fmtTime(en),
      Math.round(entryDur(e)),
      e.fields['description'] || '',
      e.fields['category'] || '其他',
      e.fields['user'] || '',
      e.fields['country'] || '中国',
      e.fields['notes'] || '',
    ])
  }
  const csv = '\ufeff' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `时间追踪_${rangeText.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ───── 下载模板 ─────
function downloadTemplate() {
  const rows = [
    ['任务名', '任务分类', '开始时间', '结束时间', '姓名', '国家', '备注'],
    ['工签-项目X', '工签', '2026-08-24 09:00', '2026-08-24 12:30', 'Jenny Chee', '中国', ''],
    ['会议-周会', '会议', '2026-08-24 14:00', '2026-08-24 15:00', 'Jenny Chee', '中国', ''],
  ]
  const csv = '\ufeff' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '时间追踪_导入模板.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ───── 导入 ─────
const showImport = ref(false)
const importPreview = ref([])
const fileInput = ref(null)

function handleFileUpload(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const text = ev.target.result.replace(/^\ufeff/, '')
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) {
      alert('文件内容为空或只有表头')
      return
    }
    // 跳过表头
    const data = []
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      if (cols.length < 4) continue
      data.push(cols)
    }
    importPreview.value = data
  }
  reader.readAsText(file, 'UTF-8')
}

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

async function doImport() {
  try {
    let success = 0
    let fail = 0
    for (const row of importPreview.value) {
      try {
        // 格式：任务名 | 任务分类 | 开始时间 | 结束时间 | 姓名 | 国家 | 备注
        const [desc, cat, start, end, user, country, notes] = row
        if (!desc || !cat || !start || !end) {
          fail++
          continue
        }
        const fields = {
          'description': desc,
          'category': cat,
          'start_time': new Date(start.replace(' ', 'T')).toISOString(),
          'end_time': new Date(end.replace(' ', 'T')).toISOString(),
          'user': user || displayName.value,
          'country': country || '中国',
          'notes': notes || '',
        }
        await http('/entries', { method: 'POST', body: { fields } })
        success++
      } catch (e) {
        fail++
      }
    }
    alert(`导入完成：成功 ${success} 条，失败 ${fail} 条`)
    showImport.value = false
    importPreview.value = []
    if (fileInput.value) fileInput.value.value = ''
    await loadEntries()
  } catch (e) {
    alert('导入失败: ' + e.message)
  }
}

onMounted(() => {
  if (userName.value) loadEntries()
})
</script>

<style scoped>
.report-view {
  max-width: 1200px;
  margin: 0 auto;
}

.page-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.range-tabs {
  display: flex;
  gap: 2px;
  background: var(--bg);
  border-radius: 6px;
  padding: 2px;
}

.range-tabs button {
  padding: 4px 12px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.range-tabs button.active {
  background: var(--surface);
  color: var(--primary);
  font-weight: 500;
  box-shadow: var(--shadow);
}

.nav-arrow {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-secondary);
}

.range-text {
  font-weight: 600;
  min-width: 140px;
}

.total-spacer {
  flex: 1;
}

.total-label {
  font-size: 14px;
  color: var(--text-secondary);
}

.total-label strong {
  color: var(--text);
  font-size: 16px;
}

.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
  font-size: 13px;
}

.data-table th,
.data-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.data-table th {
  background: var(--bg);
  font-weight: 600;
  color: var(--text-secondary);
}

.data-table tbody tr:hover {
  background: var(--bg);
}

.cat-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.row-btn {
  padding: 2px 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  margin-right: 4px;
}

.row-btn:hover {
  background: var(--bg);
}

.row-btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}

.row-btn.danger:hover {
  background: #fef2f2;
}

.empty-row {
  text-align: center;
  color: var(--text-secondary);
  padding: 24px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.import-info {
  background: var(--bg);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-secondary);
}

.import-preview {
  margin-top: 16px;
}

.preview-list {
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg);
  border-radius: 6px;
  padding: 8px;
  font-size: 12px;
  font-family: monospace;
}

.preview-row {
  padding: 2px 0;
}

.preview-more {
  color: var(--text-secondary);
  font-style: italic;
  padding: 4px 0;
}
</style>
