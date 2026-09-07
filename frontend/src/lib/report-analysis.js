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
