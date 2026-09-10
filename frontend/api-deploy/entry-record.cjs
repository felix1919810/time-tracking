function plainText(value) {
 if(typeof value==='string')return value
 if(Array.isArray(value))return value.map(plainText).join('')
 if(value&&typeof value==='object')return plainText(value.text ?? value.name ?? '')
 return ''
}
function normalizeEntry(record) {
 if(!record?.fields)return record
 const fields={...record.fields}
 for(const key of ['user','description','category','country','notes']) {
  if(Object.hasOwn(fields,key))fields[key]=plainText(fields[key])
 }
 return {...record,fields}
}
function normalizeEntryResponse(response) {
 const data={...response.data}
 for(const key of ['items','records'])if(Array.isArray(data[key]))data[key]=data[key].map(normalizeEntry)
 if(data.record)data.record=normalizeEntry(data.record)
 return {...response,data}
}
function completedEntryFields(input) {
 if(!input||typeof input.user!=='string'||!input.user.trim())throw Error('成员不能为空')
 const start=+new Date(input.start_time),end=+new Date(input.end_time)
 if(!Number.isFinite(start)||start<=0||!Number.isFinite(end)||end<=start)throw Error('结束时间必须晚于有效的开始时间')
 const fields={}
 for(const key of ['user','description','category','country','notes']) {
  if(input[key]!==undefined&&typeof input[key]!=='string')throw Error('文本字段格式无效')
  if(input[key]!==undefined)fields[key]=input[key]
 }
 return {...fields,start_time:start,end_time:end,'时长(秒)':Math.floor((end-start)/1000),'时长（小时）':Math.round((end-start)/3600000*10000)/10000}
}
module.exports={plainText,normalizeEntry,normalizeEntryResponse,completedEntryFields}
