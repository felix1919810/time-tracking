import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {listDirectory}=createRequire(import.meta.url)('../api-deploy/directory.cjs')
test('directories read all pages and deduplicate records',async()=>{
 const paths=[]
 const result=await listDirectory(async path=>{paths.push(path);return {data:path.includes('page_token=next')?{items:[{record_id:'b'},{record_id:'c'}],has_more:false}:{items:[{record_id:'a'},{record_id:'b'}],has_more:true,page_token:'next'}}},'/records','team-filter')
 assert.deepEqual(result.map(r=>r.record_id),['a','b','c']);assert.equal(paths.length,2)
 assert(paths.every(p=>p.includes('filter=team-filter')))
})
test('directories reject missing and repeated pagination cursors instead of silently truncating',async()=>{
 await assert.rejects(listDirectory(async()=>({data:{items:[],has_more:true}}),'/records'))
 let requests=0
 await assert.rejects(listDirectory(async()=>{requests++;return {data:{items:[],has_more:true,page_token:'again'}}},'/records'))
 assert.equal(requests,2)
})
