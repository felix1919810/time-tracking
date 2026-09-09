function installInputSecurity(app) {
 app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Referrer-Policy','no-referrer')
  const json=res.json.bind(res)
  res.json=data=>json(res.statusCode===500?{error:'服务暂时不可用，请稍后重试'}:data)
  const bad=()=>res.status(400).json({error:'请求参数格式无效'})
  function inspect(value,depth=0) {
   if(depth>5)throw Error('depth')
   if(typeof value==='string' && (value.length>20000||value.includes('\u0000')))throw Error('text')
   if(value&&typeof value==='object')for(const key of Object.keys(value)) {
    if(['__proto__','prototype','constructor'].includes(key))throw Error('key')
    inspect(value[key],depth+1)
   }
  }
  try {
   inspect(req.body);inspect(req.query)
   if(req.body!==undefined&&(!req.body||Array.isArray(req.body)||typeof req.body!=='object'))return bad()
   if(Object.values(req.query).some(v=>typeof v!=='string'))return bad()
   if(Object.keys(req.query).some(k=>['filter','sort'].includes(k)))return bad()
   const body=req.body||{}
   for(const id of [body.record_id,req.query.id])if(id!==undefined&&(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)))return bad()
   if(/^\/(entries|teams|categories|members)\//.test(req.path||'')) {
    for(const segment of req.path.split('/').slice(2))if(segment&&!/^[A-Za-z0-9_-]{1,128}$/.test(segment))return bad()
   }
   for(const key of ['username','password','old_password','new_password','invite_code','display_name','user','description','category','country','notes','name','team','role','color','record_id','feishu_user_id']) {
    if(body[key]!==undefined&&typeof body[key]!=='string')return bad()
   }
   if(body.fields!==undefined) {
    if(!body.fields||Array.isArray(body.fields)||typeof body.fields!=='object')return bad()
    const allowed=new Set(['user','description','category','country','notes','start_time','end_time','时长(秒)','时长（小时）'])
    for(const [key,value] of Object.entries(body.fields)) {
     if(!allowed.has(key))return bad()
     if(['start_time','end_time'].includes(key)){if(value!==null&&typeof value!=='string'&&typeof value!=='number')return bad()}
     else if(key.startsWith('时长')){if(typeof value!=='number'||!Number.isFinite(value))return bad()}
     else if(typeof value!=='string')return bad()
    }
   }
   if(body.rows!==undefined&&(!Array.isArray(body.rows)||body.rows.length>500||body.rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)||Object.values(r).some(v=>v!==null&&!['string','number'].includes(typeof v)))))return bad()
  }catch{return bad()}
  next()
 })
}
module.exports={installInputSecurity}
