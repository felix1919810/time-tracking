const RETENTION = 30 * 86400000
const text = v => typeof v === 'string' ? v : Array.isArray(v) ? v.map(x=>x.text || '').join('') : ''
function installHistory(app,{lark,appToken,timeTable,auditTable}) {
 const base=table=>'/bitable/v1/apps/'+appToken+'/tables/'+table+'/records'
 const error=(status,message)=>Object.assign(new Error(message),{status})
 const queues=new Map()
 async function locked(id,fn){const prior=queues.get(id)||Promise.resolve();const task=prior.catch(()=>{}).then(fn);queues.set(id,task);try{return await task}finally{if(queues.get(id)===task)queues.delete(id)}}
 async function list(table,filter){const items=[];let cursor='';do{const p=new URLSearchParams({page_size:'500'});if(filter)p.set('filter',filter);if(cursor)p.set('page_token',cursor);const d=(await lark(base(table)+'?'+p)).data;items.push(...(d.items||[]));cursor=d.has_more?d.page_token:'';if(d.has_more&&!cursor)throw error(503,'历史分页不完整，请重试')}while(cursor);return items}
 async function record(req,id){const r=(await lark(base(timeTable)+'/'+encodeURIComponent(id))).data.record;if(!req.canAccessEntryUser(r.fields.user))throw error(403,'无权访问该记录');return r}
 async function mutate(req,id,action){return locked(id,async()=>{
  const old=await record(req,id),f=old.fields,now=Date.now();let fields
  if(action==='restore'){
   if(!f.deleted_at)return {ok:true,record:old}
   if(now-Number(f.deleted_at)>=RETENTION)throw error(410,'记录已超过 30 天恢复期限')
   fields={deleted_at:null}
  } else if(action==='delete'){
   if(f.deleted_at)return {ok:true}
   if(!f.end_time)throw error(409,'请先停止计时，再删除这条记录')
   fields={deleted_at:now}
  } else {
   if(f.deleted_at)throw error(409,'请先恢复记录，再进行编辑')
   if(!f.end_time)throw error(409,'请先停止计时，再编辑这条记录')
   const input=req.body.fields||{};fields={}
   for(const key of ['description','category','country','notes','start_time','end_time'])if(Object.hasOwn(input,key))fields[key]=input[key]
   if(!Object.keys(fields).length)throw error(400,'没有可修改的内容')
   const start=+new Date(fields.start_time ?? f.start_time),end=+new Date(fields.end_time ?? f.end_time)
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start<=0)throw error(400,'结束时间必须晚于有效的开始时间')
   fields.start_time=start;fields.end_time=end;fields['时长(秒)']=Math.floor((end-start)/1000);fields['时长（小时）']=Math.round((end-start)/3600000*10000)/10000
  }
  const before=JSON.stringify(f),after=JSON.stringify({...f,...fields})
  if(before.length>80000||after.length>80000)throw error(400,'记录内容过长，无法安全保存历史')
  const log=(await lark(base(auditTable),'POST',{fields:{entry_id:id,actor:req.auth.user,action,occurred_at:now,before,after,status:'pending'}})).data.record
  let result
  try{result=await lark(base(timeTable)+'/'+encodeURIComponent(id),'PUT',{fields})}
  catch(e){throw error(503,'未能确认保存结果，请刷新记录后查看操作历史')}
  let auditPending=false
  try{await lark(base(auditTable)+'/'+log.record_id,'PUT',{fields:{status:'committed'}})}catch{auditPending=true}
  return {ok:true,record:result.data.record || {...old,fields:{...f,...fields}},audit_pending:auditPending}
 })}
 app.use(async(req,res,next)=>{
  const path=req.path;let action,id
  if(path==='/entries/deleted' && req.method==='GET')action='list'
  else {const match=path.match(/^\/entries\/([^/]+)\/(history|restore)$/);if(match){id=match[1];action=match[2]}}
  if(!action && (path==='/entry'||/^\/entries\/[^/]+$/.test(path)) && ['PUT','PATCH','DELETE'].includes(req.method)){id=path==='/entry'?req.query.id:path.split('/')[2];action=req.method==='DELETE'?'delete':'edit'}
  if(!action)return next()
  try{
   if(!req.auth || !req.canAccessEntryUser)throw error(401,'请重新登录')
   if(action==='list'){
    const items=(await list(timeTable,'CurrentValue.[deleted_at]>0')).filter(r=>req.canAccessEntryUser(r.fields.user)&&Date.now()-Number(r.fields.deleted_at)<RETENTION)
    return res.json({items:items.sort((a,b)=>b.fields.deleted_at-a.fields.deleted_at)})
   }
   if(action==='history'){
    if(req.method!=='GET')throw error(405,'不支持的操作')
    await record(req,id)
    const rows=await list(auditTable,'CurrentValue.[entry_id]='+JSON.stringify(id))
    const items=rows.map(r=>{const f=r.fields;return {record_id:r.record_id,actor:text(f.actor),action:text(f.action),occurred_at:f.occurred_at,status:text(f.status),before:JSON.parse(text(f.before)||'{}'),after:JSON.parse(text(f.after)||'{}')}}).sort((a,b)=>b.occurred_at-a.occurred_at)
    return res.json({items})
   }
   if(action==='restore'&&req.method!=='POST')throw error(405,'不支持的操作')
   return res.json(await mutate(req,id,action))
  }catch(e){res.status(e.status||503).json({error:e.status?e.message:'操作历史服务暂不可用，未完成操作，请重试'})}
 })
}
module.exports={installHistory,RETENTION}
