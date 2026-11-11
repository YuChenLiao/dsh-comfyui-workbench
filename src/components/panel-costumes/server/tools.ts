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
}

/** 搜：按中文描述 / 标签 / 英文关键词 / 编号找衣装。 */
function search(deps: CostumeToolDeps, args: Record<string, unknown>): Record<string, unknown> {
  const query = asString(args.query).trim()
  const category = asString(args.category).trim()
  const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 30)
  const onlySafe = args.onlySafe === true

  const known = Object.keys(deps.index.stats().categories)
  if (category !== '' && !known.includes(category)) {
    return { ok: false, error: `category 只能是 ${known.join(' / ')}，收到「${category}」。` }
  }

  const result = deps.index.search({ query, category, onlySafe, limit })
  if (result.items.length === 0) {
    const all = deps.index.search({ query, limit: 1 })
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

  return {
    ok: true,
    mode: 'search',
    total: result.total,
    costumes: result.items.map(brief),
    hint: '要哪套的图就把它的 id 传给同一个工具（不带 query）。keywords 可以直接拼进提示词。',
  }
}

/** 取图：把某套服装的图落盘，返回可当输入图的路径。 */
async function fetchOne(deps: CostumeToolDeps, id: string, sizeArg: unknown): Promise<Record<string, unknown>> {
  const item = deps.index.get(id)
  if (item === undefined) {
    return { ok: false, error: `没有这套服装：${id}。先不带 id 搜一下拿到正确的编号。` }
  }
  const size = asString(sizeArg, 'full')
  const relative = size === 'thumb' ? item.thumb : size === 'preview' ? item.preview : item.full
  try {
    const { file, mediaType } = await deps.images.materialize(relative, deps.uploadsDir())
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
      '衣装参考库（1407 套，现实风格，图中没有人物）。'
      + '**给 query 是搜**：返回编号、中文描述、分类与**英文关键词**（关键词可以直接拼进提示词，这是它最有用的地方）；'
      + '**给 id 是取图**：把那张图落到本机 uploads，返回路径，当工作流的服装参考图（配合 IPAdapter 之类）。'
      + '两件事合在一个工具里：一定是先搜到编号再取图。'
      + '**查的时候用单品名词或属性**（半身裙 / 针织 / 连衣裙 / 蕾丝 / 蝴蝶结 …）或配色（黑色 / 白色 / 棕色）：'
      + '数据是单品的组合，没有"风格"这一层 —— `水手服` / `和服` / `校服` 这类风格词查不到，要用它的构成单品去描述。',
    parameters: {
      type: 'object',
      properties: {
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
      if (id !== '') return fetchOne(deps, id, args.size)
      return search(deps, args)
    },
  }
}
