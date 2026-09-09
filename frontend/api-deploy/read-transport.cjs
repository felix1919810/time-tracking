const clone = value => JSON.parse(JSON.stringify(value))
function createReadTransport(send,{cacheable=()=>false,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const pending=new Map(),cache=new Map();let generation=0
 function invalidate(){generation++;pending.clear();cache.clear()}
 return async function request(path,method='GET',body=null) {
  if(method!=='GET') {invalidate();try{return await send(path,method,body)}finally{invalidate()}}
  const hit=cache.get(path)
  if(hit&&hit.until>now())return clone(hit.data)
  if(pending.has(path))return clone(await pending.get(path))
  const version=generation
  const task=(async()=>{
   for(let attempt=0;attempt<2;attempt++) {
    try{return await send(path,method,body)}catch(error){
     const transient=['ECONNABORTED','ETIMEDOUT','ECONNRESET','EAI_AGAIN'].includes(error.code)||[429,500,502,503,504].includes(error.response?.status)
     if(!transient||attempt===1)throw error
     await wait(250)
    }
   }
  })()
  pending.set(path,task)
  try {
   const data=await task
   if(version===generation&&cacheable(path)) {
    if(cache.size>=200)cache.delete(cache.keys().next().value)
    cache.set(path,{data:clone(data),until:now()+60000})
   }
   return clone(data)
  }finally{if(pending.get(path)===task)pending.delete(path)}
 }
}
module.exports={createReadTransport}
