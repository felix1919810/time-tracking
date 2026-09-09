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
module.exports={plainText,normalizeEntry,normalizeEntryResponse}
