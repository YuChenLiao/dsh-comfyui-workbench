/**
 * 把 ComfyUI 的执行失败分成几类，并给可执行的建议。
 *
 * 现状：`failureDetail()` 已经从 `history.status.messages` 里挖出了
 * `exception_message` + `node_id` + `node_type`，但无论什么错，hint 都是同一句
 * 「通常是模型/节点参数不匹配或显存不足。降分辨率或换底模后重试。」
 *
 * 而真实失败就那么几类，每类的解法完全不同：OOM 要降分辨率、缺模型要去装或换、
 * 输入图坏了要检查文件、参数越界要改值。模型拿到笼统的句子只能猜，猜错就是又一轮报错。
 *
 * 纯函数，不碰 IO —— 好测。
 */

/** 失败分类。 */
export type FailureKind =
  | 'oom'
  | 'missing_model'
  | 'missing_node'
  | 'bad_input'
  | 'bad_param'
  | 'unknown'

/** 分类所需的上下文（都从 history 里来）。 */
export interface FailureContext {
  /** 异常的原文。 */
  text: string
  /** 出错节点的 id。 */
  nodeId?: string | undefined
  /** 出错节点的 class_type。 */
  nodeType?: string | undefined
}

/** 模型的常见扩展名 —— 用来把"文件不存在"与"其它文件不存在"区分开。 */
const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)\b/i

/** 分类规则：先匹配先返回，顺序有讲究（先认最具体的）。 */
const RULES: Array<{ kind: FailureKind; test: (ctx: FailureContext) => boolean }> = [
  {
    kind: 'oom',
    test: ({ text }) =>
      // 英文各种写法：CUDA 的 out of memory、PyTorch 的 "OOM when allocating tensor"、
      // 系统的 "Cannot allocate memory"（Errno 12）
      /out of memory|cuda oom|allocation on device|not enough memory|outofmemoryerror|memory allocation|cannot allocate memory|oom when allocating|errno 12/i.test(text)
      // 中文：自定义节点常抛中文
      || /显存不足|显存不够|内存不足|内存不够|分配失败/.test(text),
  },
  {
    kind: 'missing_node',
    test: ({ text }) =>
      /cannot execute because node|node type not found|class_type.*not found|does not exist.*node|missing node/i.test(text)
      // 新版本 ComfyUI 的两种说法
      || /the following node types were not found/i.test(text)
      || /node ['"`].+['"`] not found/i.test(text)
      || /节点.*(不存在|未安装|找不到)/.test(text),
  },
  {
    kind: 'missing_model',
    // 只有"文件不存在" + 模型扩展名才算缺模型。
    // "Value not in list" 不归这里 —— 那个值可能只是拼写错了，候选里本来就有正确的，
    // 交给下面 bad_param 并点名"你写的是 X，候选里是 Y"。
    test: ({ text }) => /(no such file|not found|does not exist|cannot find|unable to locate)/i.test(text) && MODEL_EXT.test(text),
  },
  {
    kind: 'bad_input',
    test: ({ text }) => /cannot identify image file|invalid image|image must be|failed to open image|unsupported image/i.test(text),
  },
  {
    kind: 'bad_param',
    // 判据里的 `value not in list` 在实际链路上很少走到，别把它当成"参数写错"的万能解释：
    // 这个串由 `execution.py:1085` 的 `validate_inputs` 产生，而本分类器只吃
    // `execution_error`（来自 `/history` 的 `status.messages`）。validate 阶段的值非法
    // **不会**写成 execution_error —— ComfyUI 只拒掉那条输出链，其余链照跑，整体仍是
    // `status_str: 'success'`。那条路径的出口是 `no_output`，不是这里。
    test: ({ text }) =>
      /value not in list|out of range|must be (a |an )?(int|float|bool|number|string)|expected .* got|invalid (value|argument|parameter)/i.test(text)
      || /参数.*(不合法|越界|不在|无效)/.test(text),
  },
]

/**
 * 分类。
 *
 * @param ctx - 异常原文与节点信息。
 * @returns 分类结果；认不出就是 `unknown`。
 */
export function classifyFailure(ctx: FailureContext): FailureKind {
  for (const rule of RULES) {
    if (rule.test(ctx)) return rule.kind
  }
  return 'unknown'
}

/**
 * 从文本里捞出**出问题的那个**模型文件名。
 *
 * 关键：`Value not in list: ckpt_name: 'a.safetensorsx' not in ['a.safetensors']`
 * 这种串里有两个文件名 —— 前面是你写错的、后面是候选里正确的。要抓前面那个。
 * 直接按扩展名找第一个匹配会漏掉 `…safetensorsx`（\b 在 x 前成立），
 * 结果指向候选里那个"存在"的名字，等于把"你写错了"说成"你缺这个文件"。
 */
export function modelNameIn(text: string): string | undefined {
  // 优先：Value not in list 里被引号包住的那个值
  // 中间还夹着参数名（`Value not in list: lora_name: '…'`），
  // 所以不能要求"冒号后紧跟引号"，放宽到最近 80 字符内出现的第一个引号串。
  const rejected = text.match(/value not in list[\s\S]{0,80}?['"`]([^'"`]+)['"`]/i)
  // 注意这里**不能**用 MODEL_EXT：它的 \b 会让 `xx.safetensorsx`（拼错的、正是要被
  // 指出来的那个）不成立，于是落到下面的 fallback，抓成候选列表里那个正确的名字。
  if (rejected?.[1] !== undefined && /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)x?$/i.test(rejected[1])) {
    return rejected[1]
  }
  // 其次：No such file 之类里出现的第一个带扩展名的片段
  const match = text.match(/[\w./\\-]+\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)\b/i)
  return match?.[0]?.trim()
}

/** 从 "Value not in list" 里取出被拒的值与候选列表（给"你写的是 X，候选里是 Y"用）。 */
export function rejectedValueAndOptions(text: string): { value: string; options: string[] } | undefined {
  const match = text.match(/value not in list[\s\S]{0,80}?['"`]([^'"`]+)['"`][\s\S]{0,40}?\[([^\]]*)\]/i)
  if (match === null) return undefined
  const value = match[1]?.trim()
  if (value === undefined || value === '') return undefined
  const options = (match[2] ?? '')
    .split(',')
    .map(item => item.trim().replace(/^['"`]|['"`]$/g, ''))
    .filter(item => item !== '')
  return { value, options }
}

/** 从文本里捞出宽高（如 `1312x1840`），用于 OOM 的具体建议。 */
function dimensionsIn(text: string): { width: number; height: number } | undefined {
  const match = text.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i)
  if (match === null) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined
}

/**
 * 建议的下一个尺寸：长边砍到 1024 以内，保持比例。
 *
 * 两处都是按**同一比例**缩，避免把 768×512 压成 512×512（比例被吃成 1:1）。
 * 下限取 256：再高就会把短边抬回 512，比例又平了。
 */
function suggestSmaller(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  const scale = longEdge <= 1024 ? 0.5 : 1024 / longEdge
  // 下限只到 256 并按 64 对齐：如果把短边一律抬到 512，768×512 会变成 512×512，
  // 比例被吃成 1:1 —— 那和原图不是一个构图了。
  const snap = (value: number): number => Math.max(256, Math.round((value * scale) / 64) * 64)
  return { width: snap(width), height: snap(height) }
}


/** 两个短串的相似度（0~1），只用来挑"最接近的候选"，不追求精确。 */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  if (short === '') return 0
  // 前缀命中也算像（add-detail-xl.safetensorsx vs add-detail-xl.safetensors）
  if (long.startsWith(short)) return short.length / long.length
  let hit = 0
  const pool = long.split('')
  for (const char of short) {
    const index = pool.indexOf(char)
    if (index >= 0) {
      hit += 1
      pool.splice(index, 1)
    }
  }
  return hit / long.length
}

/**
 * 给可执行的建议。
 *
 * 每条都要说清「改什么、怎么改」，而不是"检查参数"这种话。
 *
 * @param kind - 分类结果。
 * @param ctx - 原文与节点信息（部分建议要用）。
 * @param options - 额外上下文（比如当前尺寸）。
 */
export function adviceFor(
  kind: FailureKind,
  ctx: FailureContext,
  options: { width?: number; height?: number } = {},
): string {
  const where = [ctx.nodeId === undefined ? '' : `节点 ${ctx.nodeId}`, ctx.nodeType ?? '']
    .filter(part => part !== '')
    .join(' ')

  switch (kind) {
    case 'oom': {
      const size = dimensionsIn(ctx.text)
        ?? (options.width !== undefined && options.height !== undefined
          ? { width: options.width, height: options.height }
          : undefined)
      const smaller = size === undefined ? undefined : suggestSmaller(size.width, size.height)
      const base = size === undefined
        ? '显存不够。把长边降到 1024 以内再试'
        : `显存不够（当前 ${size.width}×${size.height}）。降到 ${smaller?.width ?? 1024}×${smaller?.height ?? 1024} 再试`
      return `${base}；也可以关掉占显存的程序，或给 ComfyUI 加 --lowvram 启动参数。`
    }
    case 'missing_model': {
      const name = modelNameIn(ctx.text)
      const target = name === undefined ? '缺的那个模型文件' : `${name}`
      return `找不到${target}。用 comfyui_node_search 的 hasModel 传文件名片段，能查出本机哪些节点的可选值里真有它；确实没有就去 ComfyUI 的 models 目录补上（或在 ComfyUI-Manager 里装）。`
    }
    case 'missing_node':
      return `${where === '' ? '某个节点' : where} 在本机不存在：多半是扩展包没装。用 comfyui_node_search 传它的类名查属于哪个包，再在 ComfyUI-Manager 里装；装完要重启 ComfyUI。`
    case 'bad_input':
      return `输入图有问题（${where === '' ? '某个图片输入' : where}）。图片类节点只认 ComfyUI input/ 目录里的文件名，本地绝对路径会被判无效（comfyui_run 会自动搬运）；若仍失败，确认那个文件真的是图片、没被截断、也没被删掉。`
    case 'bad_param': {
      // "Value not in list" 是最常见的一类：值拼错了，而候选里就有对的。
      // 直接点出来，比让模型去翻 inspect 快得多。
      const rejected = rejectedValueAndOptions(ctx.text)
      if (rejected !== undefined) {
        const near = rejected.options
          .map(option => ({ option, score: similarity(rejected.value, option) }))
          .filter(item => item.score > 0.6)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(item => item.option)
        const nearHint = near.length > 0 ? `；候选里最接近的是 ${near.map(item => `'${item}'`).join('、')}` : ''
        return `${where === '' ? '某个参数' : where}的取值 '${rejected.value}' 不在候选列表里${nearHint}。改 vars 里这个键再试（共 ${rejected.options.length} 个候选，可用 comfyui_workflow 看全）。`
      }
      return `${where === '' ? '某个参数' : where}的取值不合法（不在候选列表或超出范围）。用 comfyui_workflow 加该节点的 nodeId 看它的可选值与范围，再改 vars 重试。`
    }
    default:
      return '通常是模型/节点参数不匹配。先用 comfyui_workflow 看缺不缺节点与模型，再降分辨率或换底模重试。'
  }
}
