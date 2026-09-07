// 缓存不可用或损坏时，不影响登录与记录操作。
export function readJSON(key, fallback, valid = () => true) {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return value !== null && valid(value) ? value : fallback
  } catch { return fallback }
}

export function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 缓存不是数据源 */ }
}
