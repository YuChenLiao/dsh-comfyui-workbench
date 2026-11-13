/**
 * 把上游的**动画版**服装数据整理成随包分发的 `data/costumes-anime/catalog.json`。
 *
 * ## 与写实版（`import-costumes.mjs`）的差别
 *
 * 两者同一个作者（ギア @giaaibusi）、同一套规格（不含人物的衣装搭配），但上游字段不同：
 *
 * | 写实版 | 动画版 |
 * | --- | --- |
 * | 有 `服装名称`（长串） | **没有名称**，只有 `关键词` 数组 |
 * | `关键词` 是字符串 | `关键词` 是**数组** |
 * | 图在 `thumbs/costume/` 下 | 图在 `thumbs/` 下，没有 `costume/` 层 |
 * | 图是 webp | 缩略图/预览是 webp，原图是 **png** |
 *
 * 所以没有名称时**从关键词拼**（`关键词.join('・')`）—— 拼出来的形态与写实版的名称很接近，
 * 面板与工具都按字符串用，够用。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/import-costumes-anime.mjs                       # 从上游 raw URL 拉
 * node scripts/import-costumes-anime.mjs --from ./costume-zh.json
 * node scripts/import-costumes-anime.mjs --check               # 只校验，不写盘
 * ```
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'data', 'costumes-anime')
const OUT = path.join(OUT_DIR, 'catalog.json')

const UPSTREAM_URL = 'https://raw.githubusercontent.com/Deeyu/ai-costume-gallery-zh/main/costume-anime/data/costume-zh.json'

/**
 * 图路径白名单。**必须与服务端代理那条一致**：多一个字符就等于多开一扇门。
 *
 * 动画版的路径比写实版少一层 `costume/`，但原图是 png —— 两条都要覆盖。
 */
const SAFE_PATH = /^(thumbs|img)\/[A-Z]+-\d+\.webp$|^png\/[A-Z]+-\d+\.png$/

/**
 * 成人向分类。与写实版同一套「判定只做标注、默认照样给」的规矩 ——
 * 判据写在这里而不是运行时猜，但**不拿它当默认过滤器**。
 */
const ADULT_CATEGORIES = new Set(['内衣', '性感', '泳装'])

/** 上游分类顺序（四季 → 内衣 → 派对 → 泳装 → 性感），用于稳定排序。 */
const CATEGORY_ORDER = ['春装', '夏装', '秋装', '冬装', '内衣', '派对', '泳装', '性感']

function parseArgs(argv) {
  const options = { from: UPSTREAM_URL, check: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--from') options.from = argv[++i]
    else if (arg === '--check') options.check = true
    else throw new Error(`不认识的参数：${arg}`)
  }
  return options
}

async function loadSource(from) {
  if (/^https?:\/\//.test(from)) {
    const response = await fetch(from, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`拉上游失败：HTTP ${response.status}`)
    return await response.json()
  }
  return JSON.parse(fs.readFileSync(path.resolve(from), 'utf8'))
}

/** 只保留字符串、去空白、去重。 */
function cleanList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (text === '' || out.includes(text)) continue
    out.push(text)
  }
  return out
}

/** 上游给的是完整 URL，产物里只存相对路径（代理拼 origin 用）。 */
function relativePath(url, id, field) {
  const text = String(url ?? '').trim()
  const prefix = 'https://ai-costume-anime-gallery.pages.dev/'
  if (!text.startsWith(prefix)) throw new Error(`${id} 的 ${field} 不在上游域名下：${text}`)
  const rel = text.slice(prefix.length)
  if (!SAFE_PATH.test(rel)) throw new Error(`${id} 的 ${field} 路径不合法：${rel}`)
  return rel
}

function build(records) {
  const items = []
  const categories = {}
  const seen = new Set()

  for (const record of records) {
    const id = String(record.id ?? '').trim()
    if (id === '') throw new Error('有一条缺 id')
    if (seen.has(id)) throw new Error(`id 重复：${id}`)
    seen.add(id)

    const category = typeof record.分类 === 'string' ? record.分类.trim() : ''
    if (category === '') throw new Error(`${id} 缺「分类」`)

    const tags = cleanList(record.关键词)
    if (tags.length === 0) throw new Error(`${id} 缺「关键词」—— 上游没有名称字段，没有关键词就没法展示`)

    const keywords = typeof record.英文关键词 === 'string' ? record.英文关键词.trim() : ''
    if (keywords === '') throw new Error(`${id} 缺英文关键词`)

    items.push({
      id,
      category,
      /** 上游没有名称字段，从关键词拼（形态与写实版的长串一致）。 */
      name: tags.join('・'),
      tags,
      /** 英文关键词串，可直接拼进提示词。 */
      keywords,
      adult: ADULT_CATEGORIES.has(category),
      thumb: relativePath(record.缩略图, id, 'thumb'),
      preview: relativePath(record.预览图, id, 'preview'),
      full: relativePath(record.原图, id, 'full'),
    })
    categories[category] = (categories[category] ?? 0) + 1
  }

  const order = (category) => {
    const at = CATEGORY_ORDER.indexOf(category)
    return at < 0 ? CATEGORY_ORDER.length : at
  }
  items.sort((a, b) => order(a.category) - order(b.category) || a.id.localeCompare(b.id))

  const orderedCategories = {}
  for (const category of Object.keys(categories).sort((a, b) => order(a) - order(b))) {
    orderedCategories[category] = categories[category]
  }

  return {
    version: 1,
    /** 区分两个库的来源，直接进产物便于自证。 */
    style: 'anime',
    source: 'https://github.com/Deeyu/ai-costume-gallery-zh',
    upstream: 'https://ai-costume-anime-gallery.pages.dev/',
    author: 'https://x.com/giaaibusi',
    origin: 'https://ai-costume-anime-gallery.pages.dev',
    attribution: '衣装集 アニメ版 COSTUME-ANIME-DB 由 ギア（@giaaibusi）制作，中文索引来自 Deeyu 的 ai-costume-gallery-zh。'
      + '本仓库只收录编号、分类、中文标签、英文关键词与公开图地址，不随包分发任何服装图；'
      + '图片在运行时按需经服务端代理读取。上游允许把这些图用作创作参考，'
      + '但**禁止再分发图像数据本身，也禁止批量下载（含工具自动获取）** —— 所以只能逐张取。',
    total: items.length,
    adultCount: items.filter(item => item.adult).length,
    categories: orderedCategories,
    items,
    generatedAt: new Date().toISOString(),
  }
}

/** 校验产物：字段完整、路径合法、id 唯一。 */
function verify(catalog) {
  const problems = []
  const seen = new Set()
  for (const item of catalog.items) {
    if (seen.has(item.id)) problems.push(`${item.id}：id 重复`)
    seen.add(item.id)
    for (const field of ['id', 'category', 'name', 'keywords', 'thumb', 'preview', 'full']) {
      if (typeof item[field] !== 'string' || item[field].trim() === '') problems.push(`${item.id}：缺 ${field}`)
    }
    if (!SAFE_PATH.test(item.thumb) || !SAFE_PATH.test(item.preview) || !SAFE_PATH.test(item.full)) {
      problems.push(`${item.id}：图路径不合法`)
    }
    if (!Array.isArray(item.tags) || item.tags.length === 0) problems.push(`${item.id}：缺 tags`)
    if (typeof item.adult !== 'boolean') problems.push(`${item.id}：adult 不是布尔`)
  }
  return problems
}

const options = parseArgs(process.argv.slice(2))
const records = await loadSource(options.from)
if (!Array.isArray(records)) throw new Error('上游不是数组')
console.log(`上游 ${records.length} 条`)

const catalog = build(records)
const problems = verify(catalog)
if (problems.length > 0) {
  console.error(`校验失败（${problems.length} 条）：`)
  for (const problem of problems.slice(0, 10)) console.error('  ' + problem)
  process.exit(1)
}

const adultNote = `成人向 ${catalog.adultCount} 套（内衣 / 性感 / 泳装，只标注不过滤）`
console.log(`校验通过：${catalog.total} 套 / ${Object.keys(catalog.categories).length} 个分类 / ${adultNote}`)
for (const [name, count] of Object.entries(catalog.categories)) console.log(`  ${name}: ${count}`)

if (options.check) {
  console.log('（--check：不写盘）')
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`)
  console.log(`已写入 ${path.relative(ROOT, OUT)}（${(fs.statSync(OUT).size / 1024).toFixed(0)}KB）`)
}
