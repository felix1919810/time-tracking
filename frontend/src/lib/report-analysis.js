import { durationMinutes } from './entries.js'
export function filterReportEntries(items, filters = {}, start, end) {
  return items.filter(({fields:f}) => {
    const time = new Date(f.start_time).getTime()
    return (!start || time >= +new Date(start)) && (!end || time <= +new Date(end)) &&
      Object.entries(filters).every(([key, value]) => !value || (f[key] || '') === value)
  })
}
export function reportMetrics(items, now) {
  const minutes = items.reduce((sum, entry) => sum + durationMinutes(entry, now), 0)
  const days = new Set(items.map(e => new Date(e.fields.start_time).toLocaleDateString('en-CA'))).size
  return { minutes, count: items.length, days, average: days ? minutes / days : 0 }
}

export function memberDailySeries(records, dates, members, resolveUser, now) {
  const totals = new Map(members.map(m => [m.key, new Map(dates.map(d => [d, 0]))]))
  for (const entry of records) {
    const bucket = totals.get(resolveUser(entry.fields.user))
    if (!bucket) continue
    const d = new Date(entry.fields.start_time)
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
    if (bucket.has(key)) bucket.set(key, bucket.get(key) + durationMinutes(entry, now) / 60)
  }
  return members.map(m => ({...m, data: dates.map(d => totals.get(m.key).get(d))}))
}
