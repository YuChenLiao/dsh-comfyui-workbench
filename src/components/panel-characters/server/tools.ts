/**
 * 角色库的模型侧工具。
 *
 * **一个工具、两条路径**：`comfyui_character`，给 `query` 是搜，给 `id` 是取图。
 * 与 `comfyui_pose` / `comfyui_costume` 同构，但取图多一个维度：
 *
 * 姿势是「一组多角度」，衣装是「一套一张」，角色是**一个角色五个固定槽位**
 * （三视图 / 表情 / 服装 / 道具 / 整板）。所以取图必须 `id + view` 两个参数 ——
 * 只给 id 不知道你要哪张。
 *
 * 默认 `view: 'turnaround'`：用户说「拿这个角色的三视图当参考」是最常见的用法。
 */
import { asString } from '../../../shared/tools/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { CharacterHit, CharactersIndex } from './catalog.js'
import type { PoseImages } from '../../panel-poses/server/images.js'

/** 槽位白名单。与 routes 那边保持一致。 */
const VIEWS = ['turnaround', 'expression', 'outfit', 'props', 'sheet'] as const
type View = (typeof VIEWS)[number]

export interface CharacterToolDeps {
  index: CharactersIndex
  images: PoseImages
  uploadsDir: () => string
}

/** 搜索返回只带能选的信息：20 个角色全给也还好，但保持与另两个库一致。 */
function brief(item: CharacterHit): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    subtitle: item.subtitle,
    brand: item.brand,
    views: item.slots,
  }
}

/**
 * 建 `comfyui_character` 工具。
 *
 * @param deps - 索引、取图器、uploads 目录。
 */
export function characterTool(deps: CharacterToolDeps): ToolSpec {
  return {
    name: 'comfyui_character',
    description:
      'AI 娘角色设定图库（三视图 / 表情 / 服装 / 道具）。'
      + '**给 `query` 是搜索**（返回 id、角色名、副标题、所属品牌、可用视图）；'
      + '**给 `id` 是取图**：按 `view` 落盘到 uploads 并返回绝对路径，供 comfyui_compose 或工作流当参考图。'
      + '`view` 取 turnaround（三视图，默认）/ expression（表情）/ outfit（服装拆解）/ props（道具细节）/ sheet（整板总览）。'
      + '角色图是**纯设定板**：一张板里已经排好正面/侧面/背面，喂给模型时通常不需要再拼图。'
      + '素材许可为 CC BY-NC-SA 4.0，仅供非商业参考，插件只代理取图不随包分发。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '搜索词：角色名（GLM / 鲸鱼 / Claude）、副标题、品牌或描述里的词。' },
        brand: { type: 'string', description: '按品牌过滤：OpenAI / DeepSeek / Anthropic / 智谱 GLM 等。' },
        id: { type: 'string', description: '角色 id（如 c03）。给了它就是取图，不是搜索。' },
        view: {
          type: 'string',
          enum: [...VIEWS],
          description: '取哪个视图，默认 turnaround（三视图）。只在给了 id 时有意义。',
        },
        limit: { type: 'integer', description: '搜索返回条数，默认 20，上限 100。' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const id = asString(args.id).trim()
      if (id !== '') {
        const slot = (asString(args.view).trim() || 'turnaround') as View
        if ((VIEWS as readonly string[]).includes(slot) === false) {
          return { ok: false, code: 'bad_input', error: `view 只接受 ${VIEWS.join(' / ')}。` }
        }
        const found = deps.index.get(id)
        if (found === undefined) return { ok: false, code: 'not_found', error: `没有这个角色：${id}。先用 query 搜。` }
        const rel = found.slots[slot]?.path
        if (rel === undefined) {
          return { ok: false, code: 'no_view', error: `${found.name} 没有 ${slot}，可用：${Object.keys(found.slots).join(' / ')}。` }
        }
        // 落盘目录不由调用方指定：与 `comfyui_pose` / `comfyui_costume` 对齐，
        // 统一进 uploads。多一个自定义目录就多一条要校验的写路径，
        // 而这个工具没有任何需要"落到别处"的场景。
        const dir = deps.uploadsDir()
        try {
          const ext = /\.(png|jpe?g|webp)$/i.exec(rel)?.[1]?.toLowerCase() ?? 'png'
          // 同名覆盖在这里是必然会发生的：所有角色的三视图 basename 都一样。
          const out = await deps.images.materialize(rel, dir, `${id}_${slot}.${ext}`)
          return {
            ok: true,
            id: found.id,
            name: found.name,
            view: slot,
            file: out.file,
            mediaType: out.mediaType,
            license: deps.index.stats().license,
            credit: deps.index.stats().attribution,
          }
        } catch (error) {
          return { ok: false, code: 'fetch_failed', error: error instanceof Error ? error.message : String(error) }
        }
      }

      const result = deps.index.search({
        query: asString(args.query),
        brand: asString(args.brand),
        limit: Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100),
      })
      return {
        ok: true,
        total: result.total,
        items: result.items.map(brief),
        ...(result.total === 0 ? { hint: '换个词试试：角色名（GLM / 鲸鱼）、品牌（DeepSeek / Anthropic）或描述（狐娘 / 兔娘）。' } : {}),
      }
    },
  }
}
