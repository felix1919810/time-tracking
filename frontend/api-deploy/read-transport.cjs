const clone = value => JSON.parse(JSON.stringify(value))
function createReadTransport(send,{cacheable=()=>false,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const pending=new Map(),cache=new Map();let generation=0
 function invalidate(){generation++;pending.clear();cache.clear()}
 return async function request(path,method='GET',body=null) {
  const readOnly=method==='GET'||method==='POST'&&/\/records\/search(?:\?|$)/.test(path)
  if(!readOnly) {invalidate();try{return await send(path,method,body)}finally{invalidate()}}
  const key=method+' '+path+' '+JSON.stringify(body)
  const hit=cache.get(key)
  if(hit&&hit.until>now())return clone(hit.data)
  if(pending.has(key))return clone(await pending.get(key))
  const version=generation
  const task=(async()=>{
   for(let attempt=0;attempt<2;attempt++) {
    try{return await send(path,method,body)}catch(error){
     const transient=error.providerCode===1254607||['ECONNABORTED','ETIMEDOUT','ECONNRESET','EAI_AGAIN'].includes(error.code)||[429,500,502,503,504].includes(error.response?.status)
     if(!transient||attempt===1)throw error
     await wait(error.providerCode===1254607?1000:250)
    }
   }
  })()
  pending.set(key,task)
  try {
   const data=await task
   if(version===generation&&cacheable(path)) {
    if(cache.size>=200)cache.delete(cache.keys().next().value)
    cache.set(key,{data:clone(data),until:now()+60000})
   }
   return clone(data)
  }finally{if(pending.get(key)===task)pending.delete(key)}
 }
}
module.exports={createReadTransport}
