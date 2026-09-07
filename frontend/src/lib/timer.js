import { ref, computed } from 'vue'
import { readJSON, writeJSON } from './storage.js'

export function createTimer({ http, user, displayName, emit, notify, message = text => text, now = Date.now }) {
  const activeTimer = ref(null)
  const starting = ref(false), stopping = ref(false), restoring = ref(false)
  let uncertain = false
  const tick = ref(now())
  let interval = null, startPromise = null, stopPromise = null, restorePromise = null
  let epoch = 0
  const key = () => 'tt_active_timer:' + encodeURIComponent(user())
  function persist() {
    if (user()) writeJSON(key(), activeTimer.value)
  }
  function setActive(value) {
    activeTimer.value = value
    tick.value = now()
    if (interval) clearInterval(interval)
    interval = value ? setInterval(() => { tick.value = now() }, 1000) : null
    persist()
  }
  const timerElapsedText = computed(() => {
    const seconds = Math.floor(Math.max(0, tick.value - (activeTimer.value?.startTime || tick.value)) / 1000)
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
  })

  async function startActiveTimer(payload) {
    if (!user() || activeTimer.value || starting.value || stopping.value || restoring.value) return
    if (uncertain) { await restoreActiveTimer(); return }
    const version = epoch
    const data = { ...payload, user: user(), record_id: 'temp_' + now(), startTime: now() }
    starting.value = true
    setActive(data)
    emit('timer-started', { ...data, start_time: data.startTime })
    const task = http('/timer/start', { method: 'POST', body: { ...payload, user: user() } })
    startPromise = task
    try {
      const res = await task
      if (version !== epoch) return
      if (!res.record_id || !Number.isFinite(Number(res.start_time))) throw new Error(message("服务器未返回有效计时记录"))
      setActive({ ...data, record_id: res.record_id, startTime: Number(res.start_time) })
      emit('timer-record-ready', { temp_id: data.record_id, record_id: res.record_id, start_time: Number(res.start_time) })
    } catch (e) {
      if (version === epoch) {
        setActive(null)
        emit('timer-start-failed', { temp_id: data.record_id })
        notify(message("开始计时未确认：") + e.message + message("。正在检查服务端状态。"))
        // 请求可能已写入但响应丢失，核对服务端后再允许开始。
        await restoreActiveTimer()
      }
    } finally {
      if (version === epoch) { starting.value = false; startPromise = null }
    }
  }

  function stopActiveTimer() {
    if (stopPromise) return stopPromise
    if (!activeTimer.value || restoring.value) return Promise.resolve(false)
    const version = epoch
    stopping.value = true
    const task = (async () => {
      try {
        if (startPromise) await startPromise
        if (version !== epoch || !activeTimer.value) return false
        const timer = { ...activeTimer.value }
        if (timer.record_id.startsWith('temp_')) throw new Error(message("开始计时尚未确认，请稍后重试"))
        const res = await http('/timer/stop', { method: 'POST', body: { record_id: timer.record_id } })
        if (version !== epoch) return false
        if (!res.ok) throw new Error(res.error || message("服务端未确认停止"))
        const end = Number(res.end_time) || (Number.isFinite(res.duration_ms) ? timer.startTime + res.duration_ms : now())
        setActive(null)
        emit('timer-stopped', { record_id: timer.record_id, end_time: end })
        return true
      } catch (e) {
        if (version === epoch) notify(message("停止计时失败，记录仍保留，请重试：") + e.message)
        return false
      } finally {
        if (version === epoch) { stopping.value = false; stopPromise = null }
      }
    })()
    stopPromise = task
    return task
  }

  function restoreActiveTimer() {
    if (restorePromise) return restorePromise
    if (!user()) return Promise.resolve()
    const version = epoch
    const account = user()
    restoring.value = true
    uncertain = true
    const valid = value => value && value.user === account && value.record_id && !value.record_id.startsWith('temp_') && Number(value.startTime) > 0
    const saved = readJSON(key(), null, valid) || readJSON('tt_active_timer', null, valid)
    if (saved) setActive({ ...saved, startTime: Number(saved.startTime) })
    const task = (async () => {
      try {
        // 新记录使用稳定用户名，兼容历史按姓名保存的记录。
        for (const name of new Set([account, displayName()].filter(Boolean))) {
          const res = await http('/timer/active?user=' + encodeURIComponent(name))
          if (version !== epoch) return
          if (res.record_id && res.active !== false && Number(res.start_time) > 0) {
            const value = { ...res, user: account, startTime: Number(res.start_time), color: saved?.color || '#6366f1' }
            setActive(value)
            emit('timer-restored', { ...value, user: res.user || name })
            uncertain = false
            return
          }
        }
        setActive(null)
        uncertain = false
      } catch (e) {
        if (version === epoch) notify(message("无法核对正在进行的计时：") + e.message + message("。请刷新重试。"))
      } finally {
        if (version === epoch) { restoring.value = false; restorePromise = null }
      }
    })()
    restorePromise = task
    return task
  }

  function reset() {
    // 不停止服务端计时；清空本账号在当前页面的状态，隔离迟到响应。
    epoch++
    uncertain = false
    if (interval) clearInterval(interval)
    interval = null
    activeTimer.value = null
    starting.value = stopping.value = restoring.value = false
    startPromise = stopPromise = restorePromise = null
  }
  return { activeTimer, starting, stopping, restoring, timerElapsedText, startActiveTimer, stopActiveTimer, restoreActiveTimer, reset }
}
