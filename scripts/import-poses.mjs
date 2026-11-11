/**
 * 把上游的扁平姿势数据聚合成随包分发的 `data/poses/catalog.json`。
 *
 * ## 为什么要有这一层
 *
 * 上游（`anhao/ai-pose-gallery-zh` 的 `data/pose-zh.json`）是**一条一图**的平铺结构：
 * 1439 条记录，每条都是「某个姿势 × 某个角度」，字段还是中文键名。面板要按"姿势"浏览，
 * 所以这里按（体系 + 姿势编号）聚成 288 组，每组挂 5 个角度。
 *
 * 聚合规则不是猜的：上游 1439 条的 `id` 形如 `full_single_P001_front`，
 * 前缀就是体系、`P###` 是姿势编号、后缀是角度。四种前缀与四个体系名一一对应，
 * 1439 = 365+399+400+275，与上游 README 的分类表逐项吻合。
 *
 * ## 为什么不直接把别人的 catalog 拿来用
 *
 * 我们要自己决定三件事：成人向的判据、字段形状、以及**版权声明怎么写**。
 * 上游只给名称、分类与图地址，图片一概不进仓库 —— 这一点必须由我们自己的脚本保证，
 * 而不是信任别人的产物里没有图。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/import-poses.mjs                          # 从上游 raw URL 拉
 * node scripts/import-poses.mjs --from ./pose-zh.json    # 用本地已下载的文件
 * node scripts/import-poses.mjs --check                  # 只校验现有 catalog，不写盘
 * ```
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'data', 'poses', 'catalog.json')

const UPSTREAM_URL = 'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data/pose-zh.json'

/** 上游 `id` 前缀 → 体系 id。四个前缀与四份体系名一一对应，多一个少一个都要报错。 */
const SYSTEM_BY_PREFIX = {
  full_single: { id: 'full', name: '全身单人・标准系' },
  full_sexy: { id: 'sexy', name: '全身单人・性感系' },
  upper80v2: { id: 'bust', name: '上半身单人' },
  pair60: { id: 'pair', name: '双人缠绵' },
}

/** 上游中文角度 → 角度 id。图地址的后缀就是这套 id，已对着线上实测过。 */
const ANGLE_BY_NAME = {
  正面: { id: 'front', order: 0 },
  斜侧: { id: 'diag', order: 1 },
  侧面: { id: 'side', order: 2 },
  俯视: { id: 'high', order: 3 },
  仰视: { id: 'low', order: 4 },
}

/**
 * 成人向的两个来源：整个「性感系 / 双人缠绵」体系，以及两个明确的分类。
 *
 * 上游数据**没有** adult 字段，这是一条需要我们自己的判据。取这两个分类是因为
 * 它们本身就叫「挤胸・强调事业线系」「性感・大胆系」—— 按名字判，不按内容猜。
 * 剩下的 98 组留在默认可见范围内。
 */
const ADULT_SYSTEMS = new Set(['sexy', 'pair'])
const ADULT_CATEGORIES = new Set(['挤胸・强调事业线系', '性感・大胆系'])

/** 图路径白名单，与服务端代理用的那条必须一致 —— 两边任一处放宽都算开洞。 */
const SAFE_PATH = /^(thumbs|img)\/[A-Za-z0-9_]+\.(jpg|png)$/

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

/**
 * 把 1439 条扁平记录聚成 288 组。
 *
 * 每一组的 key 是「体系 + 姿势编号」：同一组的 5 条记录共享名称与分类，
 * 差异只在角度。若同一组里出现两个不同的名称或分类，说明上游数据变了，
 * 直接报错而不是任选一个 —— 静默取第一个会让面板显示错的姿势名。
 */
function group(records) {
  const byKey = new Map()
  const seenAngles = new Map()

  for (const record of records) {
    const match = /^(.*)_(P\d+)_([a-z]+)$/.exec(String(record.id ?? ''))
    if (match === null) throw new Error(`id 形状不认识：${record.id}`)
    const [, prefix, code, angleSuffix] = match

    const system = SYSTEM_BY_PREFIX[prefix]
    if (system === undefined) throw new Error(`体系前缀不认识：${prefix}（id=${record.id}）`)
    if (record.体系 !== system.name) {
      throw new Error(`体系名与 id 前缀对不上：${record.id} 是「${record.体系}」，前缀说是「${system.name}」`)
    }

    const angle = ANGLE_BY_NAME[record.角度]
    if (angle === undefined) throw new Error(`角度不认识：${record.角度}（id=${record.id}）`)

    const key = `${system.id}:${code}`

    /**
     * 必填字段必须先校验再比较。
     *
     * 只比"组内是否一致"是不够的：上游缺字段时是 `undefined`，而
     * `undefined === undefined` 为真 —— 于是脚本会安安静静写出一份没有
     * `name` / `category` 的目录，面板上就是一行空白，`categories` 里还会多出
     * 一个字面 `"undefined"` 的键。缺字段属于上游数据坏了，必须当场报错。
     */
    if (typeof record.分类 !== 'string' || record.分类.trim() === '') {
      throw new Error(`${record.id} 缺「分类」`)
    }
    if (typeof record.姿势名称 !== 'string' || record.姿势名称.trim() === '') {
      throw new Error(`${record.id} 缺「姿势名称」`)
    }

    let bucket = byKey.get(key)
    if (bucket === undefined) {
      bucket = {
        id: `${prefix}_${code}`,
        systemId: system.id,
        system: system.name,
        code,
        category: record.分类.trim(),
        name: record.姿势名称.trim(),
        views: [],
      }
      byKey.set(key, bucket)
    }
    if (bucket.category !== record.分类) {
      throw new Error(`${key} 的分类不一致：「${bucket.category}」vs「${record.分类}」`)
    }
    if (bucket.name !== record.姿势名称) {
      throw new Error(`${key} 的名称不一致：「${bucket.name}」vs「${record.姿势名称}」`)
    }

    const angles = seenAngles.get(key) ?? new Set()
    if (angles.has(angle.id)) throw new Error(`${key} 出现重复角度：${angle.id}`)
    angles.add(angle.id)
    seenAngles.set(key, angles)

    for (const [field, value] of [['thumb', record.缩略图], ['full', record.原图]]) {
      if (!SAFE_PATH.test(String(value ?? ''))) throw new Error(`${record.id} 的 ${field} 路径不合法：${value}`)
    }

    bucket.views.push({
      id: `${bucket.id}_${angle.id}`,
      angle: record.角度,
      angleId: angle.id,
      order: angle.order,
      thumb: record.缩略图,
      full: record.原图,
    })
  }

  /**
 * 分类的检索别名。
 *
 * 索引是**小写子串 + 空格 AND**，而数据里只有中文分类词，所以 `sitting` / `standing` 这类
 * 英文查询零命中；`躺` 也查不到，因为数据把躺姿拆成了仰卧 / 侧卧 / 俯卧。
 * 这两类缺口靠"查的时候换个词"救不了 —— 只能用别名补进检索文本。
 *
 * 只写**这一层确实缺的词**：不加同义反复（`坐姿` 自己已在 name/category 里），
 * 也不做完整的同义词词典（维护不起，收益递减）。
 */
const CATEGORY_ALIASES = {
  坐姿: 'sitting seated sitting_pose',
  站姿: 'standing standing_pose',
  // 只给中性词：这个分类里仰卧/俯卧都有，`prone`（俯卧）或 `supine`（仰卧）都会错配
  趴卧: '躺 卧 卧姿 lying lying_down',
  跪立: 'kneeling kneel on_knees',
  '跪立・四肢着地': 'kneeling all_fours on_all_fours quadruped',
  '侧坐・女孩坐': 'side_sitting sitting_sideways',
  蹲姿: 'squatting squat crouching',
  前倾: 'leaning_forward lean',
  '后仰・挺背': 'leaning_back arching back_arch',
  扭身: 'twisting turned_body',
  立位: 'standing upright',
  立位贴身: 'standing_close body_to_body',
  坐位: 'seated sitting',
  面对面坐位: 'sitting_face_to_face face_to_face',
  坐位贴身: 'seated_close sitting_close',
  贴身: 'close_body holding_close',
  // 同样只给中性/侧向词，不标 prone/supine
  侧卧位: '躺 lying_side sideways lying',
  可爱系: 'cute kawaii adorable',
  '性感・大胆系': 'sexy bold seductive',
  '挤胸・强调事业线系': 'cleavage bust_emphasis',
  贴脸系: 'face_close cheek_to_cheek',
  特殊: 'special unusual',
  '正常位（传教士）': 'missionary',
  后入位: 'from_behind doggystyle',
  背向坐位: 'sitting_back_to back_view_sitting',
  骑乘位: 'cowgirl riding on_top',
}

const poses = [...byKey.values()]
  for (const pose of poses) {
    pose.views.sort((a, b) => a.order - b.order)
    for (const view of pose.views) delete view.order
    pose.adult = ADULT_SYSTEMS.has(pose.systemId) || ADULT_CATEGORIES.has(pose.category)
    // 检索用的别名（英文 + 中文同义词）。catalog 的 haystack 会带上它，
    // 所以 `sitting`、`躺` 这类原本零命中的词也能查到。
    pose.aliases = CATEGORY_ALIASES[pose.category] ?? ''
  }
  // 稳定顺序：体系（按上游声明顺序）→ 编号。面板不排序也不会每次刷新换排法。
  const systemOrder = Object.values(SYSTEM_BY_PREFIX).map(item => item.id)
  poses.sort((a, b) => systemOrder.indexOf(a.systemId) - systemOrder.indexOf(b.systemId) || a.code.localeCompare(b.code))
  return poses
}

function summarize(poses) {
  const systems = new Map()
  for (const pose of poses) {
    const entry = systems.get(pose.systemId) ?? { id: pose.systemId, name: pose.system, adult: ADULT_SYSTEMS.has(pose.systemId), poseCount: 0, viewCount: 0 }
    entry.poseCount += 1
    entry.viewCount += pose.views.length
    systems.set(pose.systemId, entry)
  }
  const categories = {}
  for (const pose of poses) categories[pose.category] = (categories[pose.category] ?? 0) + 1
  return {
    systems: [...systems.values()],
    categories,
    poseCount: poses.length,
    viewCount: poses.reduce((sum, pose) => sum + pose.views.length, 0),
    adultPoseCount: poses.filter(pose => pose.adult).length,
  }
}

function build(poses) {
  const summary = summarize(poses)
  return {
    version: 1,
    source: 'https://github.com/anhao/ai-pose-gallery-zh',
    upstream: 'https://ai-pose-gallery.pages.dev/',
    author: 'https://x.com/giaaibusi',
    origin: 'https://ai-pose-gallery.anhao.app',
    attribution: '姿势线稿与原始数据的著作权归 ギア（@giaaibusi）所有，中文译名来自 Anhao 的 ai-pose-gallery-zh。'
      + '本仓库只收录姿势名称、分类与公开图地址，不随包分发任何线稿；图片在运行时按需经服务端代理读取，不得用于商业用途。',
    ...summary,
    poses,
  }
}

/**
 * 校验现有 catalog：条数、路径白名单、成人向数量与体系计数都要自洽。
 *
 * **必须有规模下界**：所有计数都是"自己与自己比"，一份空 catalog 能全部自洽地通过
 * （第一版就是这么放过了一个聚合出 0 组的 bug）。上游是 288 组，误杀到个位数必然是坏了。
 */
function check(catalog) {
  const problems = []
  if (catalog.poses.length !== catalog.poseCount) problems.push(`poseCount 声明 ${catalog.poseCount}，实际 ${catalog.poses.length}`)
  if (catalog.poses.length < 200) problems.push(`姿势只有 ${catalog.poses.length} 组，远低于上游的 288 组，像是聚合坏了`)
  const views = catalog.poses.reduce((sum, pose) => sum + pose.views.length, 0)
  if (views !== catalog.viewCount) problems.push(`viewCount 声明 ${catalog.viewCount}，实际 ${views}`)
  const adult = catalog.poses.filter(pose => pose.adult).length
  if (adult !== catalog.adultPoseCount) problems.push(`adultPoseCount 声明 ${catalog.adultPoseCount}，实际 ${adult}`)
  const ids = new Set()
  const categories = new Set()
  for (const pose of catalog.poses) {
    if (ids.has(pose.id)) problems.push(`姿势 id 重复：${pose.id}`)
    ids.add(pose.id)
    // 必填字段：空名字/空分类在面板上就是一行空白，而计数全都对，看不出来
    if (typeof pose.name !== 'string' || pose.name.trim() === '') problems.push(`${pose.id} 缺名称`)
    if (typeof pose.category !== 'string' || pose.category.trim() === '') problems.push(`${pose.id} 缺分类`)
    else categories.add(pose.category)
    if (typeof pose.system !== 'string' || pose.system.trim() === '') problems.push(`${pose.id} 缺体系名`)
    if (pose.views.length < 4 || pose.views.length > 5) problems.push(`${pose.id} 的视角数异常：${pose.views.length}`)
    for (const view of pose.views) {
      if (!SAFE_PATH.test(view.thumb) || !SAFE_PATH.test(view.full)) problems.push(`${view.id} 的图路径不合法`)
      if (!ids.has(view.id)) ids.add(view.id)
    }
  }
  // 字面 "undefined" 出现在分类里，说明上游有缺字段的条目被当成了值
  if (categories.has('undefined')) problems.push('分类里出现字面 "undefined"：上游有缺「分类」的条目')
  return problems
}

const options = parseArgs(process.argv.slice(2))

if (options.check) {
  const catalog = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  const problems = check(catalog)
  if (problems.length > 0) {
    console.error(`import-poses：${problems.length} 处问题`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`import-poses：${catalog.poseCount} 组 / ${catalog.viewCount} 视角 / 成人向 ${catalog.adultPoseCount} 组，校验通过`)
} else {
  const source = await loadSource(options.from)
  if (!Array.isArray(source)) throw new Error('上游数据应当是数组')
  const poses = group(source)
  const catalog = build(poses)
  const problems = check(catalog)
  if (problems.length > 0) throw new Error(`生成结果自检失败：${problems.join('；')}`)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  // 先写临时文件再 rename：中途失败不会留下半个 catalog 让面板读到
  const temp = `${OUT}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(catalog)}\n`, 'utf8')
  fs.renameSync(temp, OUT)
  console.log(`import-poses：写入 ${path.relative(ROOT, OUT)}`)
  console.log(`  ${catalog.poseCount} 组 / ${catalog.viewCount} 视角 / ${catalog.systems.length} 体系 / ${Object.keys(catalog.categories).length} 分类 / 成人向 ${catalog.adultPoseCount} 组`)
  for (const system of catalog.systems) console.log(`  ${system.id.padEnd(5)} ${system.name}：${system.poseCount} 组 / ${system.viewCount} 视角`)
}
