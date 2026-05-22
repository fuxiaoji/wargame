/**
 * 下载碧蓝航线 spine Q版小人资源
 *
 * 数据来源: timelessq.com API
 * spine 版本: v3.6.52
 * 原始资源: github.com/Pelom777/AzurLaneSD
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'spine')

// 游戏舰船 → 碧蓝航线 spine model ID 映射
const SHIP_SPINE_MAP = {
  // 德军
  'bismarck':      { spineId: 'bisimai',           name: '俾斯麦' },
  'prinz-eugen':   { spineId: 'ougen',             name: '欧根亲王' },
  // 英军
  'hood':          { spineId: 'hude',              name: '胡德' },
  'prince-of-wales': { spineId: 'weiershiqinwang', name: '威尔士亲王' },
  'ark-royal':     { spineId: 'huangjiafangzhou',  name: '皇家方舟' },
  'king-george-v': { spineId: 'qiaozhiwushi',      name: '英王乔治五世' },
  'rodney':        { spineId: 'luodeni',           name: '罗德尼' },
  'renown':        { spineId: 'shengwang',         name: '声望' },
  'repulse':       { spineId: 'fanji',             name: '反击' },
  'victorious':    { spineId: 'shengli',           name: '胜利' },
  'ramillies':     { spineId: 'fuchou',            name: '复仇(代替拉米伊)' },  // 拉米伊不在碧蓝航线，用同级的复仇号
  'norfolk':       { spineId: 'nuofuke',           name: '诺福克' },
  'suffolk':       { spineId: 'safuke',            name: '萨福克' },
}

const API_BASE = 'https://api.timelessq.com'

async function fetchSpineInfo(spineId) {
  const res = await fetch(`${API_BASE}/azurlane/spine?id=${spineId}`)
  const json = await res.json()
  if (json.errno !== 0) {
    throw new Error(`Spine API error for ${spineId}: ${json.errmsg}`)
  }
  return json.data
}

async function downloadFile(url, destPath) {
  const fullUrl = url.startsWith('//') ? `https:${url}` : url
  const res = await fetch(fullUrl)
  if (!res.ok) {
    throw new Error(`Download failed: ${fullUrl} (${res.status})`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buffer)
  return buffer.length
}

async function main() {
  console.log('=== 碧蓝航线 Spine 资源下载 ===\n')

  let totalBytes = 0
  const results = []

  for (const [shipId, { spineId, name }] of Object.entries(SHIP_SPINE_MAP)) {
    console.log(`[${shipId}] ${name} (spine: ${spineId})`)

    try {
      // 1. 获取 spine 资源 URL
      const info = await fetchSpineInfo(spineId)

      const shipDir = path.join(OUT_DIR, shipId)
      fs.mkdirSync(shipDir, { recursive: true })

      // 2. 下载三个文件: .atlas, .png, .skel
      const files = [
        { url: info.atlas,  ext: '.atlas' },
        { url: info.texture, ext: '.png' },
        { url: info.skelBinary, ext: '.skel' },
      ]

      for (const { url, ext } of files) {
        const destPath = path.join(shipDir, `${spineId}${ext}`)

        // 检查是否已存在 (简单缓存)
        if (fs.existsSync(destPath)) {
          const stat = fs.statSync(destPath)
          console.log(`  ✓ ${ext} (cached, ${(stat.size / 1024).toFixed(1)} KB)`)
          totalBytes += stat.size
          continue
        }

        const size = await downloadFile(url, destPath)
        console.log(`  ↓ ${ext} (${(size / 1024).toFixed(1)} KB)`)
        totalBytes += size

        // 小延迟，避免 API 限流
        await new Promise(r => setTimeout(r, 200))
      }

      // 3. 保存元数据
      const meta = {
        shipId,
        name,
        spineId,
        spineVersion: '3.6.52',
        files: {
          atlas: `${spineId}.atlas`,
          texture: `${spineId}.png`,
          skel: `${spineId}.skel`,
        },
      }
      fs.writeFileSync(path.join(shipDir, 'meta.json'), JSON.stringify(meta, null, 2))

      results.push({ shipId, name, status: 'ok' })

    } catch (err) {
      console.log(`  ✗ 错误: ${err.message}`)
      results.push({ shipId, name, status: 'error', error: err.message })
    }

    console.log('')
    await new Promise(r => setTimeout(r, 300))
  }

  // 汇总
  console.log('=== 下载完成 ===')
  console.log(`总大小: ${(totalBytes / 1024).toFixed(1)} KB`)

  const ok = results.filter(r => r.status === 'ok')
  const fail = results.filter(r => r.status === 'error')
  console.log(`成功: ${ok.length}/${results.length}`)
  if (fail.length > 0) {
    console.log(`失败:`)
    fail.forEach(f => console.log(`  - ${f.shipId}: ${f.error}`))
  }

  // 生成映射文件供前端使用
  const mapConfig = {}
  for (const r of ok) {
    mapConfig[r.shipId] = SHIP_SPINE_MAP[r.shipId].spineId
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'ship-spine-map.json'),
    JSON.stringify(mapConfig, null, 2)
  )
  console.log('\n映射文件已生成: public/spine/ship-spine-map.json')
}

main().catch(e => { console.error(e); process.exit(1) })
