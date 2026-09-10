const crypto = require('node:crypto')
const scalar = value => typeof value === 'string' ? value : Array.isArray(value) ? scalar(value[0]?.text || value[0]?.name || value[0]) : ''
function installAuth(app, config) {
 const { lark, appToken, userTable, timeTable, categoryTable } = config
 const base = table => '/bitable/v1/apps/' + appToken + '/tables/' + table + '/records'
 const fail = (status,message) => Object.assign(new Error(message),{status})
 const attempts = new Map()
 let loginWindow = {count:0,until:0}
 const signature = text => crypto.createHmac('sha256', config.secret()).update(text).digest('base64url')
 function sign(data, ttl = 43200000) { const body=Buffer.from(JSON.stringify({...data,exp:Date.now()+ttl})).toString('base64url');return body+'.'+signature(body) }
 function verify(token,purpose) {
  const [body,mac] = String(token || '').split('.')
  if (!body || !mac) throw fail(401,'登录已失效，请重新登录')
  const expected=signature(body), a=Buffer.from(mac), b=Buffer.from(expected)
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b))throw fail(401,'登录已失效，请重新登录')
  let data;try {data=JSON.parse(Buffer.from(body,'base64url'))}catch{throw fail(401,'登录已失效，请重新登录')}
  if(data.exp<=Date.now() || data.purpose!==purpose)throw fail(401,'登录已失效，请重新登录')
  return data
 }
 async function users() {
  const items=[];let cursor=''
  do {const d=await lark(base(userTable)+'?page_size=500'+(cursor?'&page_token='+encodeURIComponent(cursor):''));items.push(...(d.data.items||[]));cursor=d.data.has_more?d.data.page_token:'';if(d.data.has_more&&!cursor)throw fail(503,'成员数据加载不完整')}while(cursor)
  return items
 }
 const identity = record => ({record_id:record.record_id,user:scalar(record.fields['用户名']),display_name:scalar(record.fields['姓名']) || scalar(record.fields['用户名']),role:['admin','team_admin'].includes(scalar(record.fields['角色'])) ? scalar(record.fields['角色']) : 'member',team:scalar(record.fields['团队']),feishu_user_id:scalar(record.fields.feishu_user_id),import_requested:record.fields.import_requested===true,can_import:['admin','team_admin'].includes(scalar(record.fields['角色'])) || record.fields.can_import===true})
 const version = record => signature(JSON.stringify([record.fields['密码'],record.fields.feishu_user_id]))
 const mutationEntryId = req => req.method==='GET' ? null : req.path==='/timer/stop' ? req.body?.record_id : req.path==='/entry' ? req.query.id : req.path!=='/entries/batch' && /^\/entries\/[^/]+$/.test(req.path) ? req.path.split('/')[2] : null
 async function authenticate(req) {
  const claims=verify(req.headers.authorization?.replace(/^Bearer /,''),'session')
  const entryId=mutationEntryId(req)
  // Both reads are fresh; fetching concurrently does not weaken revocation checks.
  const [all,entry]=await Promise.all([users(),entryId?lark(base(timeTable)+'/'+encodeURIComponent(entryId)):null])
  const record=all.find(u=>u.record_id===claims.sub)
  if(!record || version(record)!==claims.version || ['disabled','停用','禁用'].includes(scalar(record.fields['状态'])) || record.fields['停用']===true)throw fail(401,'登录已失效，请重新登录')
  if(entry)req.entrySnapshot={id:entryId,record:entry.data.record}
  return {record,all,...identity(record)}
 }
 const aliases=u=>[scalar(u.fields['用户名']),scalar(u.fields['姓名'])].filter(Boolean)
 function canUser(auth,user) {
  if(auth.role==='admin')return true
  const owners=auth.all.filter(u=>aliases(u).includes(user))
  return owners.length>0 && owners.every(u=>u.record_id===auth.record_id || auth.role==='team_admin' && auth.team && scalar(u.fields['团队'])===auth.team)
 }
 const allowedRedirect = uri => {
  try {const u=new URL(uri);return u.protocol==='https:' && !u.search && !u.hash && (
   u.hostname==='felix1919810.github.io' && ['/time-tracking/','/time-tracking/preview-20260906/'].includes(u.pathname) ||
   u.hostname==='time-tracking-frontend-1473537498.cos.ap-shanghai.myqcloud.com' && ['/','/index.html'].includes(u.pathname) ||
   u.hostname==='1473537498-ejcp1i6ib6.ap-shanghai.tencentscf.com' && ['/','/index.html'].includes(u.pathname))}catch{return false}
 }
 app.post('/auth/feishu/start',async(req,res)=>{
  res.setHeader('Cache-Control','no-store')
  try {
   const {redirect_uri,action}=req.body||{};if(!allowedRedirect(redirect_uri))throw fail(400,'登录回调地址未配置')
   const auth=action==='bind'?await authenticate(req):null
   const state=sign({purpose:'oauth',action:action==='reset'?'reset':auth?'bind':'login',redirect_uri,sub:auth?.record_id||'',nonce:crypto.randomBytes(24).toString('hex')},600000)
   const params=new URLSearchParams({client_id:config.appId(),response_type:'code',redirect_uri,state})
   res.json({state,url:'https://accounts.feishu.cn/open-apis/authen/v1/authorize?'+params})
  }catch(e){res.status(e.status||503).json({error:e.status?e.message:'登录服务暂时不可用'})}
 })
 const resetting = new Set()
 let resetWindow={count:0,until:0}
 app.post('/auth/password/reset',async(req,res)=>{
  let locked=''
  res.setHeader('Cache-Control','no-store')
  try {
   if(resetWindow.until<=Date.now())resetWindow={count:0,until:Date.now()+60000}
   if(++resetWindow.count>30)throw fail(429,'操作过于频繁，请稍后重试')
   const claims=verify(req.body?.reset_token,'password-reset')
   const password=req.body?.new_password
   if(typeof password!=='string'||password.length<12||password.length>256)throw fail(400,'新密码需为 12 至 256 位')
   if(resetting.has(claims.sub))throw fail(429,'操作过于频繁，请稍后重试')
   resetting.add(claims.sub);locked=claims.sub
   const record=(await users()).find(r=>r.record_id===claims.sub)
   if(!record || version(record)!==claims.version || !scalar(record.fields.feishu_user_id) || ['disabled','停用','禁用'].includes(scalar(record.fields['状态'])) || record.fields['停用']===true)throw fail(401,'重置验证已失效，请重新验证飞书身份')
   const {hashPassword}=require('./passwords.cjs')
   await lark(base(userTable)+'/'+encodeURIComponent(record.record_id),'PUT',{fields:{'密码':await hashPassword(password)}})
   res.json({ok:true,reauthenticate:true})
  }catch(e){res.status(e.status||503).json({error:e.status?e.message:'密码重置服务暂时不可用，请稍后重试'})}
  finally{if(locked)resetting.delete(locked)}
 })
 app.use(async(req,res,next)=>{
  try {
   req.requestTime=Date.now()
   res.setHeader('Cache-Control','no-store')
   if(Object.keys(req.query).some(k=>/token|table_id/.test(k) && k!=='page_token'))throw fail(403,'不允许指定数据表')
   const path=req.path, method=req.method
   if (['/login','/register','/change-password'].includes(path) && method==='POST') {
    if(loginWindow.until<=Date.now())loginWindow={count:0,until:Date.now()+60000}
    if(++loginWindow.count>120)throw fail(429,'操作过于频繁，请稍后重试')
    const key=signature(String(req.body?.username || ''))
    const now=Date.now(), item=attempts.get(key)
    const current=item && item.until>now ? item : {count:0,until:now+60000}
    if(++current.count>20)throw fail(429,'操作过于频繁，请稍后重试')
    attempts.set(key,current)
    if(attempts.size>5000){for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);if(attempts.size>5000)throw fail(429,'操作过于频繁，请稍后重试')}
   }
   if(path==='/test-direct')throw fail(403,'接口已关闭')
   if(path==='/feishu-auth') {
    if(method!=='POST')throw fail(405,'请重新发起飞书登录')
    const state=verify(req.body?.state,'oauth');req.oauth=state
    if(state.sub){req.auth=await authenticate(req);if(req.auth.record_id!==state.sub)throw fail(403,'绑定账号不匹配')}
    req.query.code=req.body.code;req.query.redirect_uri=state.redirect_uri
   } else if(!['/login','/register','/health','/'].includes(path)) req.auth=await authenticate(req)
   const auth=req.auth
   if(auth)req.canAccessEntryUser=user=>canUser(auth,user)
   if(path==='/auth/me')return res.json({ok:true,...identity(auth.record)})
   if(path==='/feishu-bind')throw fail(403,'请从设置页重新验证飞书身份后绑定')
   if(auth) {
    if(req.body?.fields && Object.hasOwn(req.body.fields,'deleted_at'))throw fail(403,'删除状态只能通过删除或恢复操作修改')
    const own=()=>{req.body.username=auth.user}
    if(['/change-password','/update-profile'].includes(path))own()
    if(path==='/entries/batch' && !auth.can_import)throw fail(403,'尚未获得导入权限，请联系管理员或团队管理员')
    if(path==='/timer/start'){req.body.user=auth.user}
    if(path==='/timer/active' && !canUser(auth,req.query.user))throw fail(403,'无权查看该成员数据')
    if(path==='/entries' && method==='POST' && !canUser(auth,req.body.fields?.user))throw fail(403,'无权创建该成员记录')
    const id=mutationEntryId(req)
    if(id && method!=='GET') {
     const record=req.entrySnapshot.record
     if(!canUser(auth,record.fields.user))throw fail(403,'无权修改该记录')
     if(req.body.fields && Object.hasOwn(req.body.fields,'user') && req.body.fields.user!==record.fields.user)throw fail(403,'不能更改记录所属成员')
     req.authorizedEntry=req.entrySnapshot
    }
    if(method!=='GET' && /^\/teams(?:\/|$)/.test(path) && auth.role!=='admin')throw fail(403,'仅管理员可管理团队和成员')
    if(method!=='GET' && /^\/categories(?:\/|$)/.test(path) && auth.role!=='admin') {
     if(auth.role!=='team_admin'||!auth.team)throw fail(403,'无权管理分类')
     if(path==='/categories') {if(req.body.team!==auth.team)throw fail(403,'无权管理其他团队分类')}
     else {const data=await lark(base(categoryTable)+'/'+encodeURIComponent(path.split('/')[2]));if(scalar(data.data.record.fields['团队'])!==auth.team)throw fail(403,'无权管理其他团队分类')}
    }
   }
   const json=res.json.bind(res)
   res.json= function(data) {
    if(auth && path==='/entries' && method==='GET' && Array.isArray(data.items)) {data.items=data.items.filter(e=>!e.fields.deleted_at && canUser(auth,e.fields.user));delete data.total}
    if(auth && path==='/teams/members' && Array.isArray(data.items))data.items=data.items.filter(u=>canUser(auth,u.username)).map(u=>({...u,can_import:auth.all.find(r=>r.record_id===u.record_id)?.fields.can_import===true,import_requested:auth.all.find(r=>r.record_id===u.record_id)?.fields.import_requested===true,feishu_user_id:u.record_id===auth.record_id||auth.role==='admin'?u.feishu_user_id:''}))
    if(['/login','/register','/feishu-auth'].includes(path) && (data.ok || path==='/feishu-auth' && data.feishu_user_id)) {
     ;(async()=>{
      if(path==='/feishu-auth' && req.oauth?.action==='reset'){
       // Identity comes exclusively from the provider code exchange, never the browser.
       const matches=(await users()).filter(u=>scalar(u.fields.feishu_user_id)===data.feishu_user_id && data.feishu_user_id)
       const record=matches.length===1?matches[0]:null
       if(!record || ['disabled','停用','禁用'].includes(scalar(record.fields['状态'])) || record.fields['停用']===true)throw fail(403,'此飞书身份未绑定可用账号，请联系管理员协助找回')
       return json({ok:true,reset_required:true,user:identity(record).user,reset_token:sign({purpose:'password-reset',sub:record.record_id,version:version(record)},300000)})
      }
      if(path==='/feishu-auth' && req.oauth?.sub){
       const all=await users();if(all.some(u=>scalar(u.fields.feishu_user_id)===data.feishu_user_id && u.record_id!==req.auth.record_id))throw fail(409,'该飞书账号已绑定其他用户')
       await lark(base(userTable)+'/'+req.auth.record_id,'PUT',{fields:{feishu_user_id:data.feishu_user_id}})
       req.auth.record.fields.feishu_user_id=data.feishu_user_id
       data={ok:true,...identity(req.auth.record)}
      }
      if(!data.ok)return json(data)
      const all=await users(),record=all.find(u=>scalar(u.fields['用户名'])===data.user)
      if(!record || ['disabled','停用','禁用'].includes(scalar(record.fields['状态'])) || record.fields['停用']===true)throw fail(401,'账号不可用')
      return json({...data,...identity(record),session_token:sign({purpose:'session',sub:record.record_id,version:version(record)})})
     })().catch(e=>{res.status(e.status||503);json({error:e.status?e.message:'登录服务暂时不可用'})});return res
    }
    return json(data)
   }
   next()
  }catch(e){res.status(e.status||503).json({error:e.status?e.message:'身份验证服务暂时不可用'})}
 })
 return {sign,verify,canUser,allowedRedirect}
}
module.exports={installAuth}
