import test from 'node:test'
import assert from 'node:assert/strict'
import { filterReportEntries, reportMetrics, memberDailySeries } from '../src/lib/report-analysis.js'
const entry = (user, category, date, minutes) => ({fields:{user, category, country:'中国', start_time:new Date(date).toISOString(), end_time:new Date(+new Date(date) + minutes * 60000).toISOString()}})
test('report filters combine dimension and date boundaries without mutating source', () => {
  const items = [entry('alice','会议','2026-09-07T09:00:00',60),entry('bob','培训','2026-09-07T11:00:00',30),entry('alice','会议','2026-09-08T00:00:00',90)]
  const result = filterReportEntries(items,{user:'alice',category:'会议'},new Date('2026-09-07T00:00:00'),new Date('2026-09-07T23:59:59.999'))
  assert.equal(result.length,1)
  assert.deepEqual(reportMetrics(result),{minutes:60,count:1,days:1,average:60})
  assert.equal(items.length,3)
})
test('empty comparison and active-day averages', () => {
  assert.deepEqual(reportMetrics([]),{minutes:0,count:0,days:0,average:0})
  const items = [entry('alice','会议','2026-09-07T09:00:00',60),entry('alice','会议','2026-09-07T11:00:00',30),entry('alice','会议','2026-09-09T09:00:00',90)]
  assert.deepEqual(reportMetrics(items),{minutes:180,count:3,days:2,average:90})
})

test('member trends keep zero days and separate totals when hiding members',()=>{
 const rows=[entry('alice','会议','2026-09-07T09:00:00',60),entry('Alice','会议','2026-09-07T10:00:00',30),entry('bob','会议','2026-09-08T09:00:00',120)]
 const members=[{key:'alice',label:'Alice'},{key:'bob',label:'Bob'}],dates=['2026-09-07','2026-09-08','2026-09-09']
 const resolve=u=>u==='Alice'?'alice':u
 const full=memberDailySeries(rows,dates,members,resolve)
 assert.deepEqual(full.map(m=>m.data),[[1.5,0,0],[0,2,0]])
 assert.deepEqual(memberDailySeries(rows,dates,[members[1]],resolve)[0].data,[0,2,0])
})
