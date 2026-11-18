/**
 * 从 lmy414/ai-chan-sheets 生成 `data/characters/catalog.json`。
 *
 * 只导元数据，不含图片。图片运行时由插件的代理按需拉取并落本机缓存——
 * 上游许可是 CC BY-NC-SA 4.0 且**禁止再分发图像数据**，所以条目里只允许出现
 * 相对路径，任何一步都不能把图片写进仓库。
 *
 * 两点刻意不硬编码：
 *
 * 1. **preview ↔ 角色目录的对应关系从 README 解析**，不按序号拼。上游 12 号有两个
 *    预览（`12a` / `12b`），按 `01..19` 硬拼会对不上。
 * 2. **图片路径从 git tree 里取实际存在的文件**，不拼模板。各角色的切片命名
 *    （`横版完整设定图_01_三视图_查看用.jpg` 之类）看着统一，但 15 号起有差异，
 *    拼错了只会在用户点开时 404。
 *
 * 用法：
 *   node scripts/import-characters.mjs          # 抓取并写 catalog.json
 *   node scripts/import-characters.mjs --check  # 只校验、不写盘（CI 用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'data', 'characters', 'catalog.json')
const REPO = 'lmy414/ai-chan-sheets'
const API = `https://api.github.com/repos/${REPO}`
const RAW = `https://raw.githubusercontent.com/${REPO}`

/** 图槽位：catalog 里每个槽位对应上游一个相对路径。 */
const SLOTS = [
  { key: 'turnaround', label: '三视图', match: /便于查看\/.*_01_三视图_查看用\.(jpg|jpeg|png)$/i },
  { key: 'expression', label: '表情', match: /便于查看\/.*_02_表情_查看用\.(jpg|jpeg|png)$/i },
  { key: 'outfit', label: '服装', match: /便于查看\/.*_03_服装_查看用\.(jpg|jpeg|png)$/i },
  { key: 'props', label: '道具', match: /便于查看\/.*_04_道具细节_查看用\.(jpg|jpeg|png)$/i },
  { key: 'sheet', label: '整板', match: /^完整设定图_浏览预览\.(jpg|jpeg|png)$/i },
]

/** 品牌识别：目录名里出现哪个关键词就归哪一类。顺序即优先级。 */
const BRANDS = [
  ['DeepSeek', 'DeepSeek'],
  ['智谱', '智谱 GLM'],
  ['GPT', 'OpenAI'],
  ['文心', '百度'],
  ['通义', '阿里'],
  ['Qwen', '阿里'],
  ['Kimi', '月之暗面'],
  ['豆包', '字节'],
  ['MiniMax', 'MiniMax'],
  ['Grok', 'xAI'],
  ['Gemini', 'Google'],
  ['Claude', 'Anthropic'],
  ['MiMo', '小米'],
  ['LongCat', '美团'],
  ['Mistral', 'Mistral'],
  ['Muse', 'Meta'],
]

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dsh-comfyui-workbench', Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dsh-comfyui-workbench' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.text()
}

/** 品牌归属：按目录名里的关键词归类。 */
function brandOf(dirName) {
  for (const [needle, brand] of BRANDS) if (dirName.includes(needle)) return brand
  return '其它'
}

/**
 * 从 README 的图鉴表格里抽 preview ↔ 角色目录的对应。
 *
 * 每个条目形如：
 *   <a href="设定图/01_智谱GLM娘_阔耳狐娘/…jpg"><img src="docs/previews/01.webp" alt="…"></a>
 *   <strong><a href="设定图/01_智谱GLM娘_阔耳狐娘/">智谱 GLM 娘</a></strong>
 *   <sub>01 · 阔耳狐娘</sub>
 */
function parseReadme(md) {
  const items = []
  const blocks = md.split(/<td[^>]*>/i).slice(1)
  for (const block of blocks) {
    const preview = /<img\s+src="(docs\/previews\/[^"]+\.webp)"/i.exec(block)
    const alt = /<img\s+src="[^"]+"\s+alt="([^"]*)"/i.exec(block)
    const link = /<strong><a\s+href="(设定图\/[^"]+\/)">([^<]+)<\/a><\/strong>/i.exec(block)
    const sub = /<sub>([^<]*)<\/sub>/i.exec(block)
    if (preview === null || link === null) continue
    items.push({
      dir: link[1].replace(/\/$/, ''),
      name: link[2].trim(),
      subtitle: sub === null ? '' : sub[1].trim(),
      preview: preview[1],
      alt: alt === null ? '' : alt[1].trim(),
    })
  }
  return items
}

async function main() {
  const check = process.argv.includes('--check')

  const ref = await getJson(`${API}/git/refs/heads/main`)
  const commit = ref.object.sha
  const tree = await getJson(`${API}/git/trees/${commit}?recursive=1`)
  if (tree.truncated === true) throw new Error('上游树被截断，无法完整枚举')

  const blobs = tree.tree.filter(node => node.type === 'blob')
  /**
   * 取某个角色目录下的全部文件。
   *
   * 不按 `设定图/<一层>` 预先分组：12 号角色下面还有 `冬装小肥鱼/` 这种第三层子目录，
   * README 直接链到了子目录，按固定层数分组会把它们当成「树里没有」。
   */
  const filesUnder = dir => {
    const prefix = `${dir.replace(/\/$/, '')}/`
    const map = new Map()
    for (const blob of blobs) {
      if (blob.path.startsWith(prefix) === false) continue
      map.set(blob.path.slice(prefix.length), blob)
    }
    return map
  }

  const readme = await getText(`${RAW}/${commit}/README.md`)
  const listed = parseReadme(readme)
  if (listed.length === 0) throw new Error('README 里没解析出任何角色条目，上游结构可能变了')

  const characters = []
  const problems = []
  /** 同一目录下可能有多个变体（12 号有「冬装小肥鱼」两个），序号会撞，加后缀区分。 */
  const idSeen = new Map()

  for (const item of listed) {
    const files = filesUnder(item.dir)
    if (files === undefined) {
      problems.push(`${item.dir}：README 里有，树里没有`)
      continue
    }
    const slots = {}
    for (const slot of SLOTS) {
      for (const [rel, blob] of files) {
        if (slot.match.test(rel) === false) continue
        // blob.size 只用于导入期的合理性检查：超过 8 MB 的槽位我们先记下来，
        // 运行时是否放行由 images 的 maxBytes 决定。
        slots[slot.key] = { path: `${item.dir}/${rel}`, bytes: blob.size, label: slot.label }
        break
      }
    }
    if (slots.turnaround === undefined) {
      problems.push(`${item.dir}：找不到三视图切片`)
      continue
    }
    const base = `c${(/^\d+/.exec(item.dir.split('/')[1])?.[0] ?? String(characters.length + 1)).padStart(2, '0')}`
    const seen = idSeen.get(base) ?? 0
    idSeen.set(base, seen + 1)
    const id = seen === 0 ? base : `${base}${String.fromCharCode(96 + seen + 1)}`
    characters.push({
      id,
      dir: item.dir,
      name: item.name,
      subtitle: item.subtitle,
      alt: item.alt,
      brand: brandOf(item.dir),
      preview: item.preview,
      slots,
    })
  }

  const categories = {}
  for (const item of characters) categories[item.brand] = (categories[item.brand] ?? 0) + 1

  const catalog = {
    version: 1,
    source: REPO,
    upstream: `https://github.com/${REPO}`,
    commit,
    origin: `${RAW}/${commit}`,
    license: 'CC BY-NC-SA 4.0',
    attribution: '角色设定图来自 lmy414/ai-chan-sheets（作者 ZipZipPipe 等），仅作非商业参考用途',
    note: '仓库只分发元数据，图片由插件运行时按需代理，不预取、不镜像、不再分发',
    characterCount: characters.length,
    categories,
    characters,
  }

  const text = `${JSON.stringify(catalog, null, 2)}\n`

  if (check) {
    const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (existing !== text) {
      console.error('catalog.json 与上游不一致，请运行 node scripts/import-characters.mjs 更新')
      process.exitCode = 1
      return
    }
    console.log(`catalog 已是最新（${characters.length} 个角色，commit ${commit.slice(0, 8)}）`)
    return
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, text, 'utf8')
  console.log(`写入 ${path.relative(ROOT, OUT)}`)
  console.log(`  角色 ${characters.length} 个，分类 ${Object.keys(categories).length} 个，commit ${commit.slice(0, 8)}`)
  if (problems.length > 0) {
    console.log(`  警告 ${problems.length} 条：`)
    for (const line of problems) console.log(`    - ${line}`)
  }
  const big = characters.flatMap(item =>
    Object.entries(item.slots)
      .filter(([, slot]) => slot.bytes > 8_000_000)
      .map(([key, slot]) => `${item.id}/${key} ${Math.round(slot.bytes / 1024 / 1024)}MB`),
  )
  if (big.length > 0) console.log(`  超过 8MB 的槽位（运行时按需放行）：${big.join(', ')}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
