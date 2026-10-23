/**
 * 相册的磁盘扫描与元数据读取。
 *
 * 数据源是 dsh-comfyui-image 的产物约定：图片落在磁盘上，同目录同名
 * `<图片>.json` 是它的 sidecar（含 prompt / seed / 参数 / 完整 workflow）。
 * 所以「相册」= 能扫到图片 + 能读到 sidecar 的那些文件，不需要插件间耦合。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** 认作图片的扩展名。 */
export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])

/** 扫描时直接跳过的目录：既不是用户资产，也会把一次扫描拖成几秒。 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.dsh', '.cache', '.next', '.turbo',
  '__pycache__', '.venv', 'venv', 'dist', 'build', 'target', 'coverage',
])

/** sidecar 体积上限：自定义工作流可能很大，但读进内存要有界。 */
const SIDECAR_MAX_BYTES = 8 * 1024 * 1024

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
}

/**
 * 图片扩展名对应的 MIME。
 * @param {string} filePath 文件路径。
 * @returns {string} 用于响应的 Content-Type。
 */
export function mimeOf(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 一张图片的 sidecar 路径。
 * @param {string} imagePath 图片绝对路径。
 * @returns {string} sidecar 绝对路径。
 */
export function sidecarPathOf(imagePath) {
  return `${imagePath}.json`
}

/** 元数据缓存：键为图片路径，值为 sidecar 与图片两层 mtime 及解析结果。 */
const metaCache = new Map()

/**
 * PNG 内嵌元数据的读取窗口。
 *
 * ComfyUI 的 `tEXt` 块紧跟 IHDR（实测偏移 33），所以只读文件头部就够，
 * 不必把整张图读进内存 —— 一个目录里可能有几千张图。
 */
const PNG_META_READ_BYTES = 64 * 1024

/**
 * 读 PNG 的文本块（tEXt / zTXt / iTXt）。
 *
 * 元数据都在 IDAT 之前，遇到 IDAT 直接停：后面的字节是像素数据。
 * @param {string} imagePath 图片路径。
 * @param {number} size 文件大小。
 * @returns {{ chunks: Array<{ keyword: string, value: string }>, width?: number, height?: number } | undefined} 文本块与 IHDR 尺寸。
 */
function readPngTextChunks(imagePath, size) {
  if (size < 16) return undefined
  const length = Math.min(size, PNG_META_READ_BYTES)
  let fd
  try {
    fd = fs.openSync(imagePath, 'r')
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(fd, buffer, 0, length, 0)
    if (read < 24) return undefined
    if (buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') return undefined
    // IHDR 是第一个块：宽高在偏移 16 / 20，这是图片的真实像素尺寸。
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    const chunks = []
    let offset = 8
    while (offset + 12 <= read) {
      const chunkLength = buffer.readUInt32BE(offset)
      const type = buffer.toString('ascii', offset + 4, offset + 8)
      if (type === 'IDAT' || type === 'IEND') break
      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        const data = buffer.subarray(offset + 8, Math.min(offset + 8 + chunkLength, read))
        const zero = data.indexOf(0)
        if (zero > 0) {
          const keyword = data.toString('latin1', 0, zero)
          let value
          try {
            if (type === 'tEXt') {
              value = data.toString('latin1', zero + 1)
            } else if (type === 'zTXt') {
              value = zlib.inflateSync(data.subarray(zero + 2)).toString('utf8')
            } else {
              const rest = data.subarray(zero + 3)
              const languageEnd = rest.indexOf(0)
              const translatedEnd = rest.indexOf(0, languageEnd + 1)
              value = rest.subarray(translatedEnd + 1).toString('utf8')
            }
          } catch {
            value = undefined
          }
          if (value !== undefined) chunks.push({ keyword, value })
        }
      }
      offset += 12 + chunkLength
    }
    return { chunks, width, height }
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/**
 * 从 ComfyUI 的 API 格式工作流里抽出相册要展示的字段。
 *
 * 正负提示词靠 KSampler 的 positive / negative 连线回溯（最多三层，
 * 覆盖 CLIPTextEncode 直接相连与经过 ConditioningCombine 的情况）。
 * @param {Record<string, unknown>} graph API 格式工作流。
 * @returns {Record<string, unknown> | undefined} 抽取结果。
 */
function extractFromGraph(graph) {
  const entries = Object.entries(graph).filter(([, node]) => {
    return node !== null && typeof node === 'object' && node.inputs !== null && typeof node.inputs === 'object'
  })
  if (entries.length === 0) return undefined
  const byId = new Map(entries.map(([id, node]) => [String(id), node]))

  const followText = (link, depth) => {
    if (depth > 3 || !Array.isArray(link) || link.length === 0) return undefined
    const node = byId.get(String(link[0]))
    if (node === undefined) return undefined
    const inputs = node.inputs
    if (typeof inputs.text === 'string' && inputs.text.trim() !== '') return inputs.text
    for (const key of Object.keys(inputs)) {
      const value = inputs[key]
      if (Array.isArray(value)) {
        const found = followText(value, depth + 1)
        if (found !== undefined) return found
      }
    }
    return undefined
  }

  const samplerEntry = entries.find(([, node]) => {
    return /sampler/i.test(String(node.class_type)) &&
      node.inputs.positive !== undefined && node.inputs.negative !== undefined
  })
  const samplerInputs = samplerEntry === undefined ? {} : samplerEntry[1].inputs
  const allTexts = entries
    .map(([, node]) => (typeof node.inputs.text === 'string' && node.inputs.text.trim() !== '' ? node.inputs.text : undefined))
    .filter(value => value !== undefined)

  const positive = samplerEntry === undefined ? undefined : followText(samplerInputs.positive, 0)
  const negative = samplerEntry === undefined ? undefined : followText(samplerInputs.negative, 0)
  // 兜底只在拿不到采样器连线时启用：把第一个文本当正向、最后一个当负向。
  // 多段拼接的正向提示词可能被拆开，所以这条路径的结果只能算"够用"。
  const fallbackPositive = allTexts.length > 0 ? allTexts[0] : undefined
  const fallbackNegative = allTexts.length > 1 ? allTexts[allTexts.length - 1] : undefined

  const sizeNode = entries
    .map(([, node]) => node)
    .find(node => typeof node.inputs.width === 'number' && typeof node.inputs.height === 'number')
  const modelName = entries
    .map(([, node]) => node.inputs.ckpt_name ?? node.inputs.unet_name ?? node.inputs.model_name)
    .find(value => typeof value === 'string' && value !== '')

  return {
    prompt: positive ?? fallbackPositive,
    negativePrompt: negative ?? fallbackNegative,
    seed: num(samplerInputs.seed) ?? num(samplerInputs.noise_seed),
    steps: num(samplerInputs.steps),
    cfgScale: num(samplerInputs.cfg),
    samplerName: text(samplerInputs.sampler_name),
    scheduler: text(samplerInputs.scheduler),
    width: sizeNode === undefined ? undefined : num(sizeNode.inputs.width),
    height: sizeNode === undefined ? undefined : num(sizeNode.inputs.height),
    checkpoint: text(modelName),
    workflow: graph,
  }
}

/**
 * 读 PNG 里内嵌的 ComfyUI 元数据。
 *
 * 这些图不是 `dsh-comfyui-image` 生成的（没有 `<图片>.json`），而是 ComfyUI 自己
 * 的 SaveImage 节点把 API 工作流写进了 `tEXt` 的 `prompt` 块。不读它，这类图
 * 就永远进不了相册的「仅生成图」视图。
 * @param {string} imagePath 图片路径。
 * @param {import('node:fs').Stats} stat 文件信息。
 * @returns {Record<string, unknown> | undefined} 与 sidecar 同形的元数据。
 */
function readEmbeddedMeta(imagePath, stat) {
  if (path.extname(imagePath).toLowerCase() !== '.png') return undefined
  const parsed = readPngTextChunks(imagePath, stat.size)
  if (parsed === undefined) return undefined
  const promptChunk = parsed.chunks.find(chunk => chunk.keyword === 'prompt')
  if (promptChunk === undefined) return undefined
  let graph
  try {
    graph = JSON.parse(promptChunk.value)
  } catch {
    return undefined
  }
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return undefined
  const extracted = extractFromGraph(graph)
  if (extracted === undefined) return undefined
  // 尺寸以 IHDR 为准：工作流里未必有 latent 节点，而像素尺寸永远存在。
  return {
    ...extracted,
    width: parsed.width ?? extracted.width,
    height: parsed.height ?? extracted.height,
    source: 'embedded',
  }
}

/**
 * 快速探测 PNG 是否带 ComfyUI 的 `prompt` 文本块。
 *
 * 扫描阶段只读文件头 256 字节，用来决定这张图算不算「生成图」；
 * 真正的解析留给 `readMeta`，误报会在那里被完整校验挡掉。
 * @param {string} imagePath 图片路径。
 * @returns {boolean} 是否看起来带内嵌工作流。
 */
function hasEmbeddedPromptHint(imagePath) {
  if (path.extname(imagePath).toLowerCase() !== '.png') return false
  let fd
  try {
    fd = fs.openSync(imagePath, 'r')
    const buffer = Buffer.alloc(256)
    const read = fs.readSync(fd, buffer, 0, 256, 0)
    if (read < 64 || buffer[0] !== 0x89) return false
    const head = buffer.toString('latin1', 0, read)
    return head.includes('tEXt') && head.includes('prompt')
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/**
 * 读取一张图片的元数据：优先同名 sidecar，缺失时回退到 PNG 内嵌工作流。
 *
 * 缓存按 sidecar 与图片两层 mtime 失效。任何读取或解析失败都返回 undefined ——
 * 相册不该因为一个坏文件整体失败。
 * @param {string} imagePath 图片绝对路径。
 * @returns {Record<string, unknown> | undefined} 元数据。
 */
export function readMeta(imagePath) {
  const metaPath = sidecarPathOf(imagePath)
  let sidecarStat
  let imageStat
  try {
    sidecarStat = fs.statSync(metaPath)
  } catch {
    sidecarStat = undefined
  }
  try {
    imageStat = fs.statSync(imagePath)
  } catch {
    imageStat = undefined
  }
  const sidecarKey = sidecarStat !== undefined && sidecarStat.isFile() ? sidecarStat.mtimeMs : -1
  const imageKey = imageStat !== undefined ? imageStat.mtimeMs : -1
  const cached = metaCache.get(imagePath)
  if (cached !== undefined && cached.sidecarMtimeMs === sidecarKey && cached.imageMtimeMs === imageKey) {
    return cached.meta
  }

  let meta
  if (sidecarStat !== undefined && sidecarStat.isFile() && sidecarStat.size > 0 && sidecarStat.size <= SIDECAR_MAX_BYTES) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = { ...parsed, source: 'sidecar' }
      }
    } catch {
      meta = undefined
    }
  }
  if (meta === undefined && imageStat !== undefined && imageStat.isFile()) {
    meta = readEmbeddedMeta(imagePath, imageStat)
  }
  metaCache.set(imagePath, { sidecarMtimeMs: sidecarKey, imageMtimeMs: imageKey, meta })
  return meta
}

/**
 * 兼容旧调用点：同名 sidecar 或内嵌元数据。
 * @param {string} imagePath 图片绝对路径。
 * @returns {Record<string, unknown> | undefined} 元数据。
 */
export function readSidecar(imagePath) {
  return readMeta(imagePath)
}

/** @param {unknown} value @returns {string | undefined} */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * 截断超长文本。列表一次返回几十条，提示词不设上限时响应会被个别巨型提示词撑爆；
 * 1200 字符足够覆盖实际提示词，也够灯箱展示。
 * @param {string | undefined} value 原文本。
 * @param {number} max 上限。
 * @returns {string | undefined} 截断后的文本。
 */
function clip(value, max) {
  if (value === undefined) return undefined
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** @param {unknown} value @returns {number | undefined} */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 从 ComfyUI 工作流里取模型名。
 *
 * 顶层 `checkpoint` 只在插件认出底模时才写；换了 UNET/GGUF 之类的工作流就没有这个字段，
 * 但节点参数里仍然有名字。按节点顺序取第一个权重名，够灯箱展示用。
 * @param {unknown} workflow API 格式工作流。
 * @returns {string | undefined} 模型文件名。
 */
function modelFromWorkflow(workflow) {
  if (workflow === null || typeof workflow !== 'object') return undefined
  for (const node of Object.values(workflow)) {
    if (node === null || typeof node !== 'object') continue
    const inputs = node.inputs
    if (inputs === null || typeof inputs !== 'object') continue
    for (const key of ['ckpt_name', 'unet_name', 'model_name']) {
      const value = inputs[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }
  return undefined
}

/**
 * 把 sidecar 压成列表条目需要的字段。
 * @param {Record<string, unknown> | undefined} meta sidecar 内容。
 * @returns {Record<string, unknown>} 摘要字段。
 */
function metaSummary(meta) {
  if (meta === undefined) return { hasMeta: false }
  return {
    hasMeta: true,
    // sidecar 是插件自己的记录；embedded 表示从 PNG 的 prompt 块现读出来的。
    metaSource: text(meta.source),
    prompt: clip(text(meta.prompt), 1200),
    negativePrompt: clip(text(meta.negativePrompt), 800),
    mode: text(meta.mode),
    seed: num(meta.seed),
    width: num(meta.width),
    height: num(meta.height),
    steps: num(meta.steps),
    cfgScale: num(meta.cfgScale),
    strength: num(meta.strength),
    samplerName: text(meta.samplerName),
    scheduler: text(meta.scheduler),
    checkpoint: text(meta.checkpoint) ?? modelFromWorkflow(meta.workflow),
    createdAt: text(meta.createdAt),
    workflow: meta.workflow !== undefined && meta.workflow !== null,
  }
}

/**
 * 递归收集一个根目录下的图片。
 *
 * 深度与数量都有上限：相册是浏览入口，不能变成一次全盘 IO。
 * 带 sidecar 的（插件生成物）与普通图片分开计数，保证上限先吃掉普通图片 ——
 * 一个塞满截图的目录不该把真正的生成图挤出相册。
 * @param {string} root 根目录绝对路径。
 * @param {{ maxDepth: number, maxItems: number, includeHidden: boolean }} options 扫描上限。
 * @returns {{ files: Array<{ path: string, name: string, dir: string, size: number, mtime: number }>, truncated: boolean, truncatedGenerated: boolean, truncatedBare: boolean }}
 */
export function collectImages(root, options) {
  const generated = []
  const bare = []
  let truncatedGenerated = false
  let truncatedBare = false
  const walk = (dir, depth) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const name = entry.name
      if (!options.includeHidden && name.startsWith('.')) continue
      const full = path.join(dir, name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        if (depth + 1 > options.maxDepth) continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!IMAGE_EXTS.has(path.extname(name).toLowerCase())) continue
      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      const generatedFlag = fs.existsSync(`${full}.json`) || hasEmbeddedPromptHint(full)
      const record = { path: full, name, dir, size: stat.size, mtime: stat.mtimeMs, generated: generatedFlag }
      if (generatedFlag) {
        if (generated.length < options.maxItems) generated.push(record)
        else truncatedGenerated = true
      } else if (bare.length < options.maxItems) {
        bare.push(record)
      } else {
        truncatedBare = true
      }
    }
  }
  walk(root, 0)
  const files = generated.concat(bare)
  files.sort((a, b) => b.mtime - a.mtime)
  return { files, truncated: truncatedGenerated || truncatedBare, truncatedGenerated, truncatedBare }
}

/**
 * 文件信息 + 元数据摘要 → 一条列表项。
 * @param {{ path: string, name: string, dir: string, size: number, mtime: number }} file 扫描结果。
 * @param {string} rootLabel 所属根目录显示名。
 * @returns {Record<string, unknown>} 列表项。
 */
export function toListItem(file, rootLabel) {
  return {
    path: file.path,
    name: file.name,
    dir: file.dir,
    root: rootLabel,
    size: file.size,
    mtime: file.mtime,
    ...metaSummary(readMeta(file.path)),
  }
}

/**
 * 读取一张图片的完整元数据（含 workflow）。导出工作流时用。
 * @param {string} imagePath 图片绝对路径。
 * @returns {Record<string, unknown> | undefined} 元数据。
 */
export function readFullSidecar(imagePath) {
  return readMeta(imagePath)
}
