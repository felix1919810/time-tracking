import { shallowRef, ref } from 'vue'
import { fetchAllEntries } from './http.js'

export function createEntryStore(http) {
  const items = shallowRef([])
  const error = ref('')
  const loading = ref(false)
  let revision = 0
  let session = 0
  const edits = new Map()
  let flight = null
  let loadedAt = 0
  function update(record) {
    loadedAt = 0
    revision++
    edits.set(record.record_id, { revision, record: JSON.parse(JSON.stringify(record)) })
    const map = new Map(items.value.map(item => [item.record_id, item]))
    map.set(record.record_id, JSON.parse(JSON.stringify(record)))
    items.value = [...map.values()]
  }
  function remove(id) {
    loadedAt = 0
    revision++
    edits.set(id, { revision, record: null })
    items.value = items.value.filter(item => item.record_id !== id)
  }
  function clear() {
    loadedAt = 0
    revision++
    session++
    edits.clear()
    flight = null
    items.value = []
    error.value = ''
    loading.value = false
  }
  async function load({force=false} = {}) {
    if (flight) { await flight; return items.value }
    if(!force && loadedAt && Date.now()-loadedAt<10000)return items.value
    const version = revision
    const accountSession = session
    loading.value = true
    const task = fetchAllEntries(http)
    flight = task
    try {
      const records = await task
      // 请求期间有编辑或计时事件时，旧响应不能覆盖新状态。
      if (session === accountSession) {
        const merged = new Map(records.map(record => [record.record_id, record]))
        for (const [id, edit] of edits) {
          if (edit.revision > version) {
            if (edit.record) merged.set(id, edit.record)
            else merged.delete(id)
          }
        }
        items.value = [...merged.values()]
      }
      if (flight === task) {error.value = '';loadedAt=revision===version?Date.now():0}
      return items.value
    } catch (e) {
      if (flight === task) error.value = e.message
      throw e
    } finally {
      if (flight === task) { flight = null; loading.value = false }
    }
  }
  function timerEvent(type, data) {
    if (type === 'timer-started' || type === 'timer-restored') {
      update({ record_id: data.record_id, fields: { ...data, end_time: null } })
    } else if (type === 'timer-record-ready') {
      const item = items.value.find(item => item.record_id === data.temp_id)
      remove(data.temp_id)
      if (item) update({ ...item, record_id: data.record_id, fields: { ...item.fields, start_time: data.start_time } })
    } else if (type === 'timer-start-failed') remove(data.temp_id)
    else if (type === 'timer-stopped') {
      const item = items.value.find(item => item.record_id === data.record_id)
      if (item) update({ ...item, fields: { ...item.fields, end_time: data.end_time } })
    }
  }
  return { items, error, loading, load, update, remove, clear, timerEvent }
}

export function validEditRange(start, end) {
  const a = new Date(start).getTime(), b = new Date(end).getTime()
  return Number.isFinite(a) && Number.isFinite(b) && b > a
}

export function durationMinutes(entry, now = Date.now()) {
  if (!entry?.fields?.start_time) return 0
  const start = new Date(entry.fields.start_time).getTime()
  const rawEnd = entry.fields.end_time
  const end = !rawEnd || rawEnd === 'null' || rawEnd === 'undefined' ? now : new Date(rawEnd).getTime()
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 60000) : 0
}

export function filterScopedEntries(items, { role, user, name, scope, selectedUser, team, selectedTeam, members }) {
  const ownNames = new Set([user, name].filter(Boolean))
  if (!['admin', 'team_admin'].includes(role) || scope === 'self') return items.filter(e => ownNames.has(e.fields.user))
  const teamName = role === 'team_admin' ? team : selectedTeam
  const allowedMembers = teamName ? members.filter(m => m.team === teamName) : role === 'admin' ? members : []
  const aliases = m => [m.username, m.user, m.displayName].filter(Boolean)
  let names = new Set(allowedMembers.flatMap(aliases))
  if (scope === 'member' && selectedUser) {
    const member = allowedMembers.find(m => aliases(m).includes(selectedUser))
    names = new Set(member ? aliases(member) : [])
  } else if (role === 'admin' && !teamName) return items
  return items.filter(e => names.has(e.fields.user))
}
