/**
 * 服装库的模型侧工具。
 *
 * **一个工具、两条路径**：`comfyui_costume`，给 `query` 是搜，给 `id` 是取图。
 * 与姿势库同构（那边的注释里有完整理由），但**不合并成同一个工具**：两者是不同的库、
 * 不同的分类词表（姿势是动作，衣装是穿搭场景），用途也不同 —— 姿势控构图（ControlNet
 * 吃线稿），衣装控外观（IPAdapter 吃参考图 + 关键词进提示词）。模型选哪个是意图判断，
 * 不该降级成一个 `kind` 参数。
 *
 * **服装数据自带英文关键词**：搜索返回里直接给 `keywords`，模型拿到就能拼进 prompt ——
 * 不用再猜"这身衣服该怎么说"。
 */
import { isFillerTail } from '../../../shared/search/fallback.js'
import { asString } from '../../../shared/tools/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { CostumeItem, CostumesIndex } from './catalog.js'
import type { PoseImages } from '../../panel-poses/server/images.js'

/** 工具返回只带必要字段：1407 套全给会把上下文吃光。 */
function brief(item: CostumeItem): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    keywords: item.keywords,
    adult: item.adult,
  }
}

export interface CostumeToolDeps {
  index: CostumesIndex
  images: PoseImages
  uploadsDir: () => string
  /**
   * 动画版衣装库（1320 套，二次元画风）。给了才有 `source: "anime"`。
   *
   * 与写实版**分开索引、分开缓存、分开原站**：两库的 id 都是 `SPR-xxxx` 格式，
   * 混在一个索引里会撞号，所以必须由调用方明确指定 source。
   */
  anime?: { index: CostumesIndex; images: PoseImages; uploadsDir: () => string } | undefined
}

/**
 * 一个库的取用面。
 *
 * `uploadsDir` 必须分开：两库的 id 都是 `SPR-xxxx`，`materialize` 又按 basename 落盘，
 * 共用同一个目录的话，写实版 SPR-0001 与动画版 SPR-0001 会互相覆盖 ——
 * 工作流里那条旧路径会悄悄换成另一画风的图。
 */
interface Store { index: CostumesIndex; images: PoseImages; uploadsDir: () => string }

/** 搜：按中文描述 / 标签 / 英文关键词 / 编号找衣装。 */
function search(store: Store, args: Record<string, unknown>): Record<string, unknown> {
  const query = asString(args.query).trim()
  const category = asString(args.category).trim()
  const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 30)
  const onlySafe = args.onlySafe === true

  const known = Object.keys(store.index.stats().categories)
  if (category !== '' && !known.includes(category)) {
    return { ok: false, error: `category 只能是 ${known.join(' / ')}，收到「${category}」。` }
  }

  const result = store.index.search({ query, category, onlySafe, limit })
  if (result.items.length === 0) {
    const all = store.index.search({ query, limit: 1 })
    return {
      ok: true,
      mode: 'search',
      costumes: [],
      total: 0,
      note: all.total === 0
        ? '没有匹配的服装。换个词试试（中文描述或英文关键词都行），或者去掉 category / onlySafe。'
        : `有 ${all.total} 套符合关键词，但被 category / onlySafe 过滤掉了。去掉条件再查。`,
    }
  }

  // 与姿势库同一套判断：砍掉实词就说明语义被破坏（`牛仔外套` → 那 175 条里没有一件外套），
  // 给结果反而误导；砍掉虚词照常给。
  const storeTotal = store.index.stats().total
  const broadRatio = storeTotal > 0 ? result.total / storeTotal : 0
  if (result.fellBack && !isFillerTail(result.droppedTail ?? '')) {
    return {
      ok: false,
      mode: 'search',
      matchedQuery: result.usedQuery,
      droppedTail: result.droppedTail,
      error: `「${query}」没命中。自动砍短成「${result.usedQuery}」能查到 ${result.total} 套（占全库 ${Math.round(broadRatio * 100)}%），`
        + `但砍掉的「${result.droppedTail}」是实词 —— 那些结果里可能根本没有「${result.droppedTail}」。`,
      hint: '换个词：用单品名词（连衣裙 / 半身裙 / 针织 / 蕾丝）或配色（黑色 / 白色 / 棕色），别用风格词（水手服 / 和服）。全表见 skill。',
    }
  }

  return {
    ok: true,
    mode: 'search',
    total: result.total,
    costumes: result.items.map(brief),
    // 回退过的词必须说出来（理由同姿势库）
    ...(result.fellBack
      ? {
        matchedQuery: result.usedQuery,
        droppedTail: result.droppedTail,
        matchedHint: `「${query}」没命中，砍掉「${result.droppedTail}」后按「${result.usedQuery}」查到 ${result.total} 套`
          + `（占全库 ${Math.round(broadRatio * 100)}%）。结果可能比你要的宽 —— 被砍掉的那部分在数据里可能根本不存在。`,
      }
      : {}),
    hint: '要哪套的图就把它的 id 传给同一个工具（不带 query）。keywords 可以直接拼进提示词。',
  }
}

/** 取图：把某套服装的图落盘，返回可当输入图的路径。 */
async function fetchOne(store: Store, id: string, sizeArg: unknown): Promise<Record<string, unknown>> {
  const item = store.index.get(id)
  if (item === undefined) {
    return { ok: false, error: `没有这套服装：${id}。先不带 id 搜一下拿到正确的编号。` }
  }
  const size = asString(sizeArg, 'full')
  const relative = size === 'thumb' ? item.thumb : size === 'preview' ? item.preview : item.full
  try {
    const { file, mediaType } = await store.images.materialize(relative, store.uploadsDir())
    return {
      ok: true,
      mode: 'fetch',
      file,
      mediaType,
      size,
      costume: {
        id: item.id,
        name: item.name,
        category: item.category,
        keywords: item.keywords,
        // 前 8 个分类标签：比 keywords 更细，模型拼提示词时能直接挑（HEAD 就有，合并时别丢）
        tags: item.tags.slice(0, 8),
      },
      next: '图里只有衣服、没有人物，适合当服装参考（IPAdapter / 参考图控制）；keywords 拼进提示词描述这件衣服。',
    }
  } catch (error) {
    return {
      ok: false,
      error: `服装参考图取不到：${error instanceof Error ? error.message : String(error)}`,
      hint: '图来自第三方图床，它不可用时这条就取不到；衣装检索本身不受影响。',
    }
  }
}

/**
 * `comfyui_costume`：**给 query 搜索，给 id 取图**。
 *
 * @param deps - 索引 + 取图器。
 */
export function costumeTool(deps: CostumeToolDeps): ToolSpec {
  return {
    name: 'comfyui_costume',
    description:
      '衣装参考库，两个画风版本：`source: "real"`（默认，1407 套实拍风）与 `source: "anime"`（1320 套二次元风）。'
      + '两版都是**不含人物的衣装搭配**，带中文标签与**英文关键词**（可直接拼进提示词）；给 `query` 搜、给 `id` 取图。'
      + '**选画风看你要什么**：要真实服装质感用 real；要二次元画风的服装用 anime —— 后者当参考图时会把画风一起带进去。'
      + '**查的时候用单品名词或属性**（半身裙 / 针织 / 连衣裙 / 蕾丝）或配色（黑色 / 白色 / 棕色）：'
      + '数据是单品的组合，没有"风格"这一层 —— `水手服` / `和服` / `校服` 这类风格词查不到，要用它的构成单品去描述。'
      + '两库词表略有差异：动画版说「缎带」「吊带背心」「牛仔布」「皮革」，写实版说「蝴蝶结」「吊带衫」「牛仔」「皮质」—— 查不到时换个同义词再试。',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['real', 'anime'],
          description: '查哪个库：real 写实风（默认，1407 套）、anime 二次元风（1320 套）。两库编号格式相同，所以必须明确指定。',
        },
        query: {
          type: 'string',
          description: '搜索关键词：中文描述（牛仔裙）、中文标签（荷叶边）或英文词（denim knit）。空格分隔多个词做 AND。给 id 时忽略。',
        },
        category: {
          type: 'string',
          description: '搜索结果按分类筛：春季穿搭 / 夏季穿搭 / 秋季穿搭 / 冬季穿搭 / 内衣・睡衣 / 性感穿搭 / 泳装・度假 / 派对・礼服。不传则全部。',
        },
        onlySafe: { type: 'boolean', description: '搜索结果只看常规穿搭（默认 false，即全部）。' },
        limit: { type: 'integer', description: '搜索最多返回几套，默认 10，上限 30。' },
        id: { type: 'string', description: '服装编号，如 SPR-0001。**给了它就取图，不是搜索。**' },
        size: {
          type: 'string',
          enum: ['thumb', 'preview', 'full'],
          description: '取图尺寸：thumb 缩略图、preview 中等、full 原图（webp）。默认 full。',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => {
      const id = asString(args.id).trim()
      // source 决定查哪个库。写实版 1407 套（实拍照风），动画版 1320 套（二次元画风）——
      // 两库同 id 格式，所以必须明确指定，不能猜。
      const sourceArg = asString(args.source, 'real').trim().toLowerCase()
      if (sourceArg !== 'real' && sourceArg !== 'anime') {
        return { ok: false, error: `source 只能是 real（写实）或 anime（二次元），收到「${sourceArg}」。` }
      }
      const store: Store | undefined = sourceArg === 'anime'
        ? deps.anime
        : { index: deps.index, images: deps.images, uploadsDir: deps.uploadsDir }
      if (store === undefined) {
        return { ok: false, error: '这个安装没接动画版衣装库（data/costumes-anime 缺失）。用 source: "real" 或不传。' }
      }

      const out = id === '' ? search(store, args) : await fetchOne(store, id, args.size)
      return { ...out, source: sourceArg }
    },
  }
}
