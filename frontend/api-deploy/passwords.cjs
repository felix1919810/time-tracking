const crypto = require('node:crypto')
const {promisify} = require('node:util')
const scrypt = promisify(crypto.scrypt)
const scalar = v => typeof v === 'string' ? v : Array.isArray(v) ? scalar(v[0]?.text || v[0]?.name || v[0]) : ''
// OWASP scrypt profile: 16 MiB, five passes. Bound simultaneous work per instance.
let running = 0
async function derive(password, salt) {
 if (running >= 4) throw Object.assign(Error('登录繁忙，请稍后重试'), {status:429})
 running++
 try { return await scrypt(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024}) } finally { running-- }
}
async function hashPassword(password) {
 const salt=crypto.randomBytes(16).toString('hex')
 return 'scrypt$16384$8$5$'+salt+'$'+(await derive(password,salt)).toString('hex')
}
function equal(a,b) {const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();return crypto.timingSafeEqual(x,y)}
async function verifyPassword(password,stored) {
 if(typeof password!=='string'||!password.length||password.length>256||!stored)return false
 if(!stored.startsWith('scrypt$'))return equal(password,stored)
 const m=stored.match(/^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/)
 return !!m && equal((await derive(password,m[1])).toString('hex'),m[2])
}
function installPasswords(app,{lark,appToken,userTable,settingsTable}) {
 const base=table=>'/bitable/v1/apps/'+appToken+'/tables/'+table+'/records'
 async function list(table) {let items=[],cursor='';do{const d=(await lark(base(table)+'?page_size=500'+(cursor?'&page_token='+encodeURIComponent(cursor):''))).data;items.push(...(d.items||[]));cursor=d.has_more?d.page_token:'';if(d.has_more&&!cursor)throw Error('Incomplete list')}while(cursor);return items}
 const text=(v,max=128)=>typeof v==='string'&&v.length>0&&v.length<=max
 const strong=p=>text(p,256)&&p.length>=12
 const problem=(res,e)=>res.status(e.status||503).json({ok:false,error:e.status?e.message:'账号服务暂时不可用，请稍后重试'})
 app.post('/login',async(req,res)=>{try{
  const {username,password}=req.body||{}
  if(!text(username)||!text(password,256))return res.status(400).json({ok:false,error:'用户名或密码格式无效'})
  const matches=(await list(userTable)).filter(r=>scalar(r.fields['用户名'])===username)
  const record=matches.length===1?matches[0]:null,stored=scalar(record?.fields['密码'])
  if(!record||!await verifyPassword(password,stored))return res.status(401).json({ok:false,error:'用户名或密码错误'})
  if(!stored.startsWith('scrypt$'))await lark(base(userTable)+'/'+encodeURIComponent(record.record_id),'PUT',{fields:{'密码':await hashPassword(password)}})
  return res.json({ok:true,user:username})
 }catch(e){problem(res,e)}})
 app.post('/register',async(req,res)=>{try{
  const {username,password,invite_code,display_name}=req.body||{}
  if(!text(username)||username.trim()!==username||!text(invite_code)||!strong(password)||display_name!==undefined&&display_name!==''&&!text(display_name))return res.status(400).json({ok:false,error:'用户名、邀请码格式无效，或密码不足 12 位（最多 256 位）'})
  const settings=await list(settingsTable)
  if(!settings.some(r=>scalar(r.fields['设置项'])==='邀请码'&&equal(scalar(r.fields['值']),invite_code)))return res.status(403).json({ok:false,error:'邀请码错误'})
  if((await list(userTable)).some(r=>scalar(r.fields['用户名'])===username))return res.status(409).json({ok:false,error:'用户名已存在'})
  await lark(base(userTable),'POST',{fields:{'用户名':username,'密码':await hashPassword(password),'角色':'user','姓名':display_name||username}})
  return res.json({ok:true,user:username})
 }catch(e){problem(res,e)}})
 app.post('/change-password',async(req,res)=>{try{
  const {old_password,new_password}=req.body||{}
  if(!strong(new_password))return res.status(400).json({ok:false,error:'新密码需为 12 至 256 位'})
  if(!await verifyPassword(old_password,scalar(req.auth.record.fields['密码'])))return res.status(403).json({ok:false,error:'原密码错误'})
  await lark(base(userTable)+'/'+encodeURIComponent(req.auth.record_id),'PUT',{fields:{'密码':await hashPassword(new_password)}})
  return res.json({ok:true,reauthenticate:true})
 }catch(e){problem(res,e)}})
}
module.exports={hashPassword,verifyPassword,installPasswords}
