async function listDirectory(lark, path, filter) {
  const records = new Map(), seen = new Set()
  let cursor = ''
  do {
    const query = new URLSearchParams({page_size:'500'})
    if (filter) query.set('filter', filter)
    if (cursor) query.set('page_token', cursor)
    const result = await lark(path + '?' + query)
    const data = result.data
    if (!Array.isArray(data?.items)) throw Error('Invalid directory response')
    for (const record of data.items) records.set(record.record_id, record)
    if (!data.has_more) return [...records.values()]
    if (!data.page_token || seen.has(data.page_token)) throw Error('Incomplete directory pagination')
    cursor = data.page_token
    seen.add(cursor)
  } while (cursor)
}
module.exports = {listDirectory}
