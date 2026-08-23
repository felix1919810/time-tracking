// 把 dist/ 上传到七牛云对象存储
// 用法：node upload-qiniu.js
import qiniu from 'qiniu'
import fs from 'fs'
import path from 'path'

const AK = 'DaO-LrpCztQTg_F5QNTMEwxYt7DMNq7gefxWaLFn'
const SK = 'dTsS3gFhhNmzjdwYzhuPzk6nTiseecehIaJSAUVe'
const BUCKET = 'timetracking'  // 七牛空间名
const DIST_DIR = './dist'   // Vite 打包输出目录

const mac = new qiniu.auth.digest.Mac(AK, SK)
const config = new qiniu.conf.Config()
config.zone = qiniu.zone.Zone_z0  // 华东，按您实际区域改

function uploadFile(localFile, key) {
  return new Promise((resolve, reject) => {
    const putPolicy = new qiniu.rs.PutPolicy({ scope: `${BUCKET}:${key}` })
    const token = putPolicy.uploadToken(mac)
    const formUploader = new qiniu.form_up.FormUploader(config)
    const putExtra = new qiniu.form_up.PutExtra()
    formUploader.putFile(token, key, localFile, putExtra, (err, body, info) => {
      if (err) return reject(err)
      if (info.statusCode === 200) resolve(body)
      else reject(new Error(`上传失败 ${info.statusCode}: ${JSON.stringify(body)}`))
    })
  })
}

function walkDir(dir, base = '') {
  const files = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = base ? `${base}/${name}` : name
    const stat = fs.statSync(full)
    if (stat.isDirectory()) files.push(...walkDir(full, rel))
    else files.push({ local: full, key: rel })
  }
  return files
}

async function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('dist/ 不存在，请先 npm run build')
    process.exit(1)
  }
  const files = walkDir(DIST_DIR)
  console.log(`共 ${files.length} 个文件待上传`)
  let ok = 0, fail = 0
  for (const f of files) {
    try {
      await uploadFile(f.local, f.key)
      console.log(`  ✓ ${f.key}`)
      ok++
    } catch (e) {
      console.error(`  ✗ ${f.key}: ${e.message}`)
      fail++
    }
  }
  console.log(`\n完成：成功 ${ok}，失败 ${fail}`)
  console.log('\n访问地址（七牛测试域名）：')
  console.log(`  http://pxtl1m3so.bkt.clouddn.com/index.html`)
  console.log('\n注意：测试域名 30 天后失效，需绑定自定义域名')
}

main().catch(e => { console.error(e); process.exit(1) })
