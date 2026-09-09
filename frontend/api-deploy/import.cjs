const scalar=v=>typeof v==='string'?v:Array.isArray(v)?scalar(v[0]?.text||v[0]?.name||v[0]):''
function parseTime(value){
 if(value===undefined||value===null||value==='')return null
 if(typeof value==='number')return Number.isFinite(value)?value:null
 const s=String(value).trim();const m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
 if(m){const parts=m.slice(1).map(x=>Number(x||0));const [y,month,day,h,min,sec]=parts;const utc=Date.UTC(y,month-1,day,h,min,sec),d=new Date(utc);if(d.getUTCFullYear()!==y||d.getUTCMonth()!==month-1||d.getUTCDate()!==day||h>23||min>59||sec>59)return null;return utc-8*3600000}
 if(/^\d{13}$/.test(s))return Number(s)
 if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s)){const n=Date.parse(s);return Number.isFinite(n)?n:null}
 return null
}
function normalizeRows(rows,auth,canUser){
 if(!Array.isArray(rows)||!rows.length||rows.length>500)throw Error('每次请选择 1 至 500 条记录')
 return rows.map((r,index)=>{
  const get=(...keys)=>keys.map(k=>r[k]).find(v=>v!==undefined&&v!==null&&v!=='')
  const problem=message=>{throw Error('第 '+(index+2)+' 行：'+message)}
  let member=String(get('user','成员','用户','username')||auth.user).trim()
  const exact=auth.all.filter(u=>scalar(u.fields['用户名'])===member)
  const matches=exact.length?exact:auth.all.filter(u=>scalar(u.fields['姓名'])===member)
  if(matches.length!==1)problem('成员不存在或姓名不唯一，请填写登录用户名')
  member=scalar(matches[0].fields['用户名']);if(!canUser(member))problem('无权导入该成员数据')
  const title=String(get('description','任务名称','描述')||'').trim();if(!title)problem('任务名称不能为空')
  const startRaw=get('startTime','任务开始时间','开始时间')||get('date','日期'),endRaw=get('endTime','任务结束时间','结束时间'),hoursRaw=get('hours','工时')
  const start=parseTime(startRaw);let end=parseTime(endRaw)
  if(start===null||start<=0)problem('开始时间无效，请使用 YYYY-MM-DD HH:mm:ss')
  const hours=hoursRaw===undefined?null:Number(hoursRaw)
  if(hours!==null&&(!Number.isFinite(hours)||hours<=0))problem('工时必须是大于零的数字')
  if(endRaw!==undefined && end===null)problem('结束时间无效')
  if(end===null&&hours!==null)end=start+Math.round(hours*3600000)
  if(end===null||end<=start)problem('结束时间必须晚于开始时间，或提供有效工时')
  if(hours!==null && Math.abs(hours-(end-start)/3600000)>0.02)problem('工时与起止时间不一致')
  const seconds=Math.round((end-start)/1000)
  return {fields:{user:member,description:title,category:String(get('category','任务分类','分类')||'其他'),country:String(get('country','国家')||''),notes:String(get('notes','备注','remark')||''),start_time:start,end_time:end,'时长(秒)':seconds,'时长（小时）':seconds/3600}}
 })
}
function installImport(app,{lark,appToken,timeTable,userTable}){
 const base=table=>'/bitable/v1/apps/'+appToken+'/tables/'+table+'/records'
 app.post('/import-permission/request',async(req,res)=>{
  try {
   if(req.auth.can_import)return res.json({ok:true,can_import:true,import_requested:false})
   if(!req.auth.record.fields.import_requested)await lark(base(userTable)+'/'+encodeURIComponent(req.auth.record_id),'PUT',{fields:{import_requested:true}})
   res.json({ok:true,can_import:false,import_requested:true})
  }catch{res.status(503).json({error:'申请提交失败，请重试'})}
 })
 app.post('/members/:id/import-permission',async(req,res)=>{
  try{
   const auth=req.auth,target=auth.all.find(u=>u.record_id===req.params.id)
   if(!target)return res.status(404).json({error:'成员不存在'})
   if(!['admin','team_admin'].includes(auth.role)||auth.role==='team_admin'&&(!auth.team||scalar(target.fields['团队'])!==auth.team))return res.status(403).json({error:'无权设置该成员的导入权限'})
   if(['admin','team_admin'].includes(scalar(target.fields['角色'])))return res.status(400).json({error:'管理角色默认可导入，无需单独授权'})
   if(typeof req.body.can_import!=='boolean')return res.status(400).json({error:'导入权限必须为布尔值'})
   await lark(base(userTable)+'/'+encodeURIComponent(target.record_id),'PUT',{fields:{can_import:req.body.can_import,import_requested:false}})
   res.json({ok:true,can_import:req.body.can_import})
  }catch(e){res.status(503).json({error:'权限保存失败，请重试'})}
 })
 app.post('/entries/batch',async(req,res)=>{
  if(!req.auth?.can_import)return res.status(403).json({error:'尚未获得导入权限，请联系管理员或团队管理员'})
  let records;try{records=normalizeRows(req.body.rows,req.auth,req.canAccessEntryUser)}catch(e){return res.status(400).json({error:e.message})}
  try{
   const data=await lark(base(timeTable)+'/batch_create','POST',{records})
   const created=data.data.records||[]
   if(created.length!==records.length)return res.status(503).json({error:'导入结果未完整确认，请先刷新报表核对，避免重复导入'})
   res.json({success:created.length,failed:0,records:created})
  }catch(e){res.status(503).json({error:'导入结果未确认，请先刷新报表核对，避免重复导入'})}
 })
}
module.exports={installImport,normalizeRows,parseTime}
