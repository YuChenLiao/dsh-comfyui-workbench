/**
 * 把上游的服装数据整理成随包分发的 `data/costumes/catalog.json`。
 *
 * ## 与姿势库的差别
 *
 * 上游 `data/costume-zh.json` 已经是**一条一套**（1407 条，不需要聚合），而且比姿势那边
 * 多两样东西：中文标签数组、以及**英文关键词串**（`ivory frill knit denim mini skirt…`）。
 * 后者直接就是能写进提示词的素材，所以一个字都不改地收进来。
 *
 * 三处与姿势库不同的形状要单独处理：
 * - id 带连字符（`SPR-0001`），姿势是下划线
 * - 图在 `thumbs/costume/` 与 `img/costume/` 下（多一层目录）
 * - 图是 **webp**，不是 jpg/png
 *
 * ## 用法
 *
 * ```sh
 * node scripts/import-costumes.mjs                        # 从上游 raw URL 拉
 * node scripts/import-costumes.mjs --from ./costume-zh.json
 * node scripts/import-costumes.mjs --check                # 只校验，不写盘
 * ```
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'data', 'costumes', 'catalog.json')

const UPSTREAM_URL = 'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data/costume-zh.json'

/** 图路径白名单。**必须与服务端代理那条一致**：多一个字符就等于多开一扇门。 */
const SAFE_PATH = /^(thumbs|img)\/costume\/[A-Za-z0-9_-]+\.webp$/

/**
 * 成人向的三个分类。与姿势库同一套「判定只做标注、默认照样给」的规矩 ——
 * 判据写在这里而不是运行时猜，但**不拿它当默认过滤器**。
 */
const ADULT_CATEGORIES = new Set(['内衣・睡衣', '泳装・度假', '性感穿搭'])

/** 四类季节 + 四个特殊分类，用于稳定排序。 */
const CATEGORY_ORDER = ['春季穿搭', '夏季穿搭', '秋季穿搭', '冬季穿搭', '内衣・睡衣', '性感穿搭', '泳装・度假', '派对・礼服']

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

/** 只保留字符串、去空白、去重。标签与关键词都要过一遍。 */
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

function build(records) {
  const items = []
  const categories = {}
  const seen = new Set()

  for (const record of records) {
    const id = String(record.id ?? '').trim()
    if (id === '') throw new Error('有一条缺 id')
    if (seen.has(id)) throw new Error(`id 重复：${id}`)
    seen.add(id)

    // 必填字段先校验再比较：缺字段时 undefined 会安静地流进产物，
    // 面板上就是一张没有名字的卡片（姿势库那边踩过这个）
    const category = typeof record.分类 === 'string' ? record.分类.trim() : ''
    const name = typeof record.服装名称 === 'string' ? record.服装名称.trim() : ''
    if (category === '') throw new Error(`${id} 缺「分类」`)
    if (name === '') throw new Error(`${id} 缺「服装名称」`)

    for (const [field, value] of [['thumb', record.缩略图], ['preview', record.预览图], ['full', record.原图]]) {
      if (!SAFE_PATH.test(String(value ?? ''))) throw new Error(`${id} 的 ${field} 路径不合法：${value}`)
    }

    const keywords = typeof record.关键词 === 'string' ? record.关键词.trim() : ''
    const tags = cleanList(record.标签)

    items.push({
      id,
      category,
      name,
      tags,
      /** 英文关键词串，可直接拼进提示词。上游覆盖率 100%，空串说明上游坏了。 */
      keywords,
      adult: ADULT_CATEGORIES.has(category),
      thumb: record.缩略图,
      preview: record.预览图,
      full: record.原图,
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
    source: 'https://github.com/anhao/ai-pose-gallery-zh',
    upstream: 'https://ai-costume-gallery.pages.dev/',
    author: 'https://x.com/giaaibusi',
    origin: 'https://ai-pose-gallery.anhao.app',
    attribution: '衣装集 COSTUME-DB-01 由 ギア（@giaaibusi）制作，中文名称与关键词来自 Anhao 的 ai-pose-gallery-zh。'
      + '本仓库只收录编号、中文名、标签、英文关键词与公开图地址，不随包分发任何服装图；'
      + '图片在运行时按需经服务端代理读取。上游允许把这些图用作创作参考，禁止再分发图像数据本身。',
    total: items.length,
    adultCount: items.filter(item => item.adult).length,
    categories: orderedCategories,
    items,
  }
}

/**
 * 校验现有 catalog。
 *
 * 与姿势库同一条教训：所有计数都是"自己与自己比"，一份空目录能自洽地通过 ——
 * 所以必须有规模下界。
 */
function check(catalog) {
  const problems = []
  if (!Array.isArray(catalog.items)) return ['items 不是数组']
  if (catalog.items.length !== catalog.total) problems.push(`total 声明 ${catalog.total}，实际 ${catalog.items.length}`)
  if (catalog.items.length < 1000) problems.push(`只有 ${catalog.items.length} 套，远低于上游的 1407，像是导入坏了`)
  const adult = catalog.items.filter(item => item.adult).length
  if (adult !== catalog.adultCount) problems.push(`adultCount 声明 ${catalog.adultCount}，实际 ${adult}`)
  const ids = new Set()
  let missingKeywords = 0
  for (const item of catalog.items) {
    if (ids.has(item.id)) problems.push(`id 重复：${item.id}`)
    ids.add(item.id)
    if (typeof item.name !== 'string' || item.name.trim() === '') problems.push(`${item.id} 缺名称`)
    if (typeof item.category !== 'string' || item.category.trim() === '') problems.push(`${item.id} 缺分类`)
    if (typeof item.keywords !== 'string' || item.keywords.trim() === '') missingKeywords += 1
    for (const key of ['thumb', 'preview', 'full']) {
      if (!SAFE_PATH.test(item[key])) problems.push(`${item.id} 的 ${key} 路径不合法`)
    }
  }
  // 关键词是这套数据的核心价值（能直接进提示词），缺一条就要说出来
  if (missingKeywords > 0) problems.push(`${missingKeywords} 套缺英文关键词`)
  return problems
}

const options = parseArgs(process.argv.slice(2))

if (options.check) {
  const catalog = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  const problems = check(catalog)
  if (problems.length > 0) {
    console.error(`import-costumes：${problems.length} 处问题`)
    for (const problem of problems.slice(0, 20)) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`import-costumes：${catalog.total} 套 / ${Object.keys(catalog.categories).length} 类 / 成人向 ${catalog.adultCount} 套，校验通过`)
} else {
  const source = await loadSource(options.from)
  if (!Array.isArray(source)) throw new Error('上游数据应当是数组')
  const catalog = build(source)
  const problems = check(catalog)
  if (problems.length > 0) throw new Error(`生成结果自检失败：${problems.slice(0, 5).join('；')}`)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const temp = `${OUT}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(catalog)}\n`, 'utf8')
  fs.renameSync(temp, OUT)
  console.log(`import-costumes：写入 ${path.relative(ROOT, OUT)}`)
  console.log(`  ${catalog.total} 套 / ${Object.keys(catalog.categories).length} 类 / 成人向 ${catalog.adultCount} 套`)
  for (const [category, count] of Object.entries(catalog.categories)) console.log(`  ${category}：${count}`)
}
