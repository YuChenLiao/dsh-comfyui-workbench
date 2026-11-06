/**
 * 服装库的模型侧工具。
 *
 * 与姿势库的分工一样：`search` 找人、`fetch` 把图落到 uploads 当参考图。
 *
 * **不一样的地方**：服装数据自带英文关键词，`search` 的返回里直接给出 `keywords`，
 * 模型拿到就能拼进 prompt —— 不用再猜"这身衣服该怎么说"。
 */
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { CostumeItem, CostumesIndex } from './catalog.js'
import type { PoseImages } from '../../panel-poses/server/images.js'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 工具返回只带必要字段：1407 套全给会把上下文吃光。 */
function brief(item: CostumeItem): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    keywords: item.keywords,
    ...(item.adult ? { adult: true } : {}),
  }
}

export interface CostumeToolDeps {
  index: CostumesIndex
  images: PoseImages
  uploadsDir: () => string
}

/**
 * `comfyui_costume_search`：按中文描述 / 标签 / 英文关键词 / 编号找衣装。
 *
 * @param deps - 索引。
 */
export function costumeSearchTool(deps: CostumeToolDeps): ToolSpec {
  return {
    name: 'comfyui_costume_search',
    description:
      '在衣装参考库里找服装（1407 套，现实风格，图中没有人物）。'
      + '返回编号、中文描述、分类与**英文关键词**——关键词可以直接拼进提示词，这是它最有用的地方。'
      + '拿到 id 后用 comfyui_costume_fetch 取图，当工作流的服装参考图（配合 IPAdapter 之类）。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '关键词：中文描述（牛仔裙）、中文标签（荷叶边）或英文词（denim knit）。空格分隔多个词做 AND。',
        },
        category: {
          type: 'string',
          description: '分类：春季穿搭 / 夏季穿搭 / 秋季穿搭 / 冬季穿搭 / 内衣・睡衣 / 性感穿搭 / 泳装・度假 / 派对・礼服。不传则全部。',
        },
        onlySafe: { type: 'boolean', description: '只看常规穿搭（默认 false，即全部）。' },
        limit: { type: 'integer', description: '最多返回几套，默认 10，上限 30。' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => {
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
          costumes: [],
          total: 0,
          note: all.total === 0
            ? '没有匹配的服装。换个词试试（中文描述或英文关键词都行），或者去掉 category / onlySafe。'
            : `有 ${all.total} 套符合关键词，但被 category / onlySafe 过滤掉了。去掉条件再查。`,
        }
      }

      return {
        ok: true,
        total: result.total,
        costumes: result.items.map(brief),
      }
    },
  }
}

/**
 * `comfyui_costume_fetch`：把某套服装的图落盘，返回可当输入图的路径。
 *
 * @param deps - 索引 + 取图器。
 */
export function costumeFetchTool(deps: CostumeToolDeps): ToolSpec {
  return {
    name: 'comfyui_costume_fetch',
    description:
      '把某套服装的参考图下载到本机 uploads 目录，返回文件路径，用作工作流的输入图。'
      + '图里只有衣服、没有人物，适合当服装参考（IPAdapter / 参考图控制）。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '服装编号，如 SPR-0001。' },
        size: {
          type: 'string',
          enum: ['thumb', 'preview', 'full'],
          description: 'thumb 是缩略图、preview 中等、full 是原图（webp）。默认 full。',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => {
      const id = asString(args.id).trim()
      if (id === '') return { ok: false, error: 'id 不能为空' }
      const item = deps.index.get(id)
      if (item === undefined) {
        return { ok: false, error: `没有这套服装：${id}。先用 comfyui_costume_search 找编号。` }
      }
      const size = asString(args.size, 'full')
      const relative = size === 'thumb' ? item.thumb : size === 'preview' ? item.preview : item.full
      try {
        const { file, mediaType } = await deps.images.materialize(relative, deps.uploadsDir())
        return {
          ok: true,
          file,
          mediaType,
          size,
          costume: {
            id: item.id,
            name: item.name,
            category: item.category,
            keywords: item.keywords,
            tags: item.tags.slice(0, 8),
          },
          next: '把 file 作为工作流的图片输入；服装描述可直接用 keywords 拼进提示词。',
        }
      } catch (error) {
        return {
          ok: false,
          error: `服装图取不到：${error instanceof Error ? error.message : String(error)}`,
          hint: '图来自第三方图床（ai-pose-gallery.anhao.app），它不可用时这条就取不到；检索本身不受影响。',
        }
      }
    },
  }
}
