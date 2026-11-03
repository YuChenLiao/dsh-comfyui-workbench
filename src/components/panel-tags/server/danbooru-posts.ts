/**
 * 参考面板的数据源：**Danbooru 的 posts**。
 *
 * 为什么不是「prompt 数据集」：`FredZhang7` 那类只有文本，用户要的"每条参考带参考图"
 * 满足不了；`DiffusionDB` 有图但它是 zip 分片，单片就 527 MB —— 为了配图下半个 G 不值。
 * Danbooru 的 `posts.json` 一次请求同时给出**图**（`preview_file_url` / `large_file_url`）、
 * **tag 串**（还按 general / character / copyright / artist 分好类）和**服务端搜索**
 * （`tags=` 支持完整查询语法），而且零落盘 —— 前端直接 `<img src>` 加载。
 *
 * 与本插件的标签库同源：参考出来的就是"用 danbooru tag 写的提示词"，与 `comfyui_run`
 * 的 `vars.prompt` 是同一种语言。
 *
 * 限流：匿名请求约 10 req/s。**不走 `tool-danbooru` 的 `fetchJson`** —— 那套带
 * SFW 镜像（`safebooru.donmai.us`）与模块级的"上次成功镜像"状态，用它取 posts 有两个坑：
 * `rating=all` 降级到镜像后一条 NSFW 都没有（用户以为搜不到），而那个 `preferred`
 * 是跨调用共享的 —— 一次 posts 超时会把后续 `tags.json` / `wiki` 查询也钉在镜像上，
 * 标签库静默变成子集。所以这里自己发请求：单主站、单独的超时、单独的重试。
 */
/** Danbooru 主站。 */
const BASE = 'https://danbooru.donmai.us'
/** posts 查询比 tag 查询重，给宽一点；且宁可慢一点也不无限等。 */
const TIMEOUT_MS = 15_000

/** 一条参考。 */
export interface PostRef {
  /** Danbooru 的 post id，用于溯源。 */
  id: number
  /** 分级：g / s / q / e。 */
  rating: string
  /** 分数（社区投票，越高越"被认可"）。 */
  score: number
  width: number
  height: number
  /** 小图（180×180），列表里当缩略图。 */
  previewUrl: string
  /** 大图（sample 尺寸），点开看。 */
  largeUrl: string
  /** 原图；可能很大，仅作备用。 */
  fileUrl: string
  /** 完整 tag 串 —— 这就是可以直接拿去生图的提示词。 */
  prompt: string
  /** 按类拆开的 tag（面板可以分组显示）。 */
  tags: {
    general: string[]
    character: string[]
    copyright: string[]
    artist: string[]
  }
}

/** 查询参数。 */
export interface PostQuery {
  /** 搜索词（Danbooru 的 tag 查询语法，空格分隔即 AND）。 */
  query?: string
  limit?: number
  /** 分级过滤：默认只给 general（安全）与 sensitive。 */
  rating?: 'general' | 'all'
}

/** 单次最多取几条。 */
const MAX_LIMIT = 20
/** 默认几条。 */
const DEFAULT_LIMIT = 12

/** 把 Danbooru 的一条 post 转成面板要的形状；缺图或缺 tag 的丢弃。 */
export function toRef(raw: unknown): PostRef | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const post = raw as Record<string, unknown>
  const previewUrl = typeof post.preview_file_url === 'string' ? post.preview_file_url : ''
  const prompt = typeof post.tag_string === 'string' ? post.tag_string.trim() : ''
  // 没有图或没有 tag 的都不算"参考"
  if (previewUrl === '' || prompt === '') return undefined
  const split = (key: string): string[] =>
    typeof post[key] === 'string' ? String(post[key]).trim().split(/\s+/).filter(word => word !== '') : []
  return {
    id: typeof post.id === 'number' ? post.id : 0,
    rating: typeof post.rating === 'string' ? post.rating : '',
    score: typeof post.score === 'number' ? post.score : 0,
    width: typeof post.image_width === 'number' ? post.image_width : 0,
    height: typeof post.image_height === 'number' ? post.image_height : 0,
    previewUrl,
    largeUrl: typeof post.large_file_url === 'string' && post.large_file_url !== '' ? post.large_file_url : previewUrl,
    fileUrl: typeof post.file_url === 'string' && post.file_url !== '' ? post.file_url : previewUrl,
    prompt,
    tags: {
      general: split('tag_string_general'),
      character: split('tag_string_character'),
      copyright: split('tag_string_copyright'),
      artist: split('tag_string_artist'),
    },
  }
}

/**
 * 拉一批参考。
 *
 * **不落盘**：每次都是一次实时请求，结果只活在这一次响应里。所以没有缓存要失效、
 * 没有池子会坏、也没有"建池跑到一半被限流"。
 *
 * @param options - 查询词、条数、分级。
 */
export async function fetchPostRefs(options: PostQuery = {}): Promise<PostRef[]> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const query = (options.query ?? '').trim()
  // 默认只给 general（安全分级）。`all` 表示**不加分级过滤**，g/s/q/e 全来 ——
  // 这个开关在面板上（"全分级"复选），默认关。
  const rating = options.rating === 'all' ? '' : ' rating:general'
  const tags = `${query}${rating}`.trim()
  // **不能用 `order:random`**：匿名请求下 Danbooru 对它直接返回 500（实测）。
  // 改成随机翻页。上限取匿名的 1000 页而不是 100 —— 12 条 × 100 页只覆盖"最新 1200 条"
  // （danbooru 日增几千帖，等于最近几小时），翻灵感会反复撞同一批。
  const page = query === '' ? Math.floor(Math.random() * 1000) + 1 : 1
  const url = `${BASE}/posts.json?tags=${encodeURIComponent(tags)}&limit=${limit}&page=${page}`

  // 只重试一次：2 次 × 15 秒已经够糟，"换一批"卡更久不如直接报错。
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'dsh-comfyui-workbench' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`取参考失败：HTTP ${res.status}`)
      const body: unknown = await res.json()
      if (!Array.isArray(body)) return []
      return body.map(toRef).filter((ref): ref is PostRef => ref !== undefined)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
