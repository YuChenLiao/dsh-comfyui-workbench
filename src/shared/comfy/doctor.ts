/**
 * 环境自检（Doctor）与开箱模板生成。
 *
 * 解决的是"装好了但一张图都出不来"这个最常见的冷启动问题：插件起来了、面板亮了，
 * 但 ComfyUI 没起 / 没有模型 / 工作流库是空的 / 输出目录不可写 —— 这四种情况
 * 在界面上的表现都是"点了没反应"，而原因各不相同。
 *
 * 两条设计约束：
 * 1. **只诊断，不擅自修**：除了"生成基础模板"这个显式动作，其余一律只给建议，
 *    绝不偷偷拉起服务或改配置（用户可能是故意关掉的）。
 * 2. **每项都要能定位**：`detail` 说清现状，`fix` 说清下一步该做什么；
 *    只有 `level: 'fail'` 的项才让整体 `ok: false`，`warn` 不阻塞。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 单项结论。 */
export type DoctorLevel = 'ok' | 'warn' | 'fail'

/** 一条诊断项。 */
export interface DoctorItem {
  /** 稳定的机器可读 id（面板据此跳转/排序）。 */
  id: 'service' | 'models' | 'workflows' | 'output' | 'gpu'
  title: string
  level: DoctorLevel
  /** 现状描述（会直接显示给用户）。 */
  detail: string
  /** 可执行的下一步；`ok` 时通常没有。 */
  fix?: string
}

/** 一次自检的结论。 */
export interface DoctorReport {
  /** 没有 `fail` 项就算通过。 */
  ok: boolean
  items: DoctorItem[]
}

/** 自检需要的外部能力（全部注入，`shared/comfy` 不认识组件层）。 */
export interface DoctorDeps {
  /** ComfyUI 地址（只用于展示）。 */
  baseUrl: string
  /** 拉系统信息；失败即视为服务不可用。 */
  systemStats: () => Promise<unknown>
  /** 拉节点定义；用它列出本机模型。 */
  objectInfo: () => Promise<unknown>
  /** 已启用的工作流数量。 */
  workflowCount: () => number
  /** 产物目录。 */
  outputDir: string
  /** 可写性校验；抛错即不可写。 */
  assertWritable: (dir: string) => void
}

/** 从 `/object_info` 里按节点字段取枚举值（如 `ckpt_name`）。 */
export function enumOf(objectInfo: unknown, className: string, input: string): string[] {
  if (objectInfo === null || typeof objectInfo !== 'object') return []
  const node = (objectInfo as Record<string, unknown>)[className]
  if (node === null || typeof node !== 'object') return []
  const inputs = (node as { input?: unknown }).input
  if (inputs === null || typeof inputs !== 'object') return []
  const bag = inputs as Record<string, unknown>
  for (const group of ['required', 'optional']) {
    const section = bag[group]
    if (section === null || typeof section !== 'object') continue
    const spec = (section as Record<string, unknown>)[input]
    if (!Array.isArray(spec)) continue
    const first = spec[0]
    if (!Array.isArray(first)) continue
    return first.filter((item): item is string => typeof item === 'string')
  }
  return []
}

/** 从系统信息里读显存摘要（取第一块卡）。 */
export function gpuSummary(raw: unknown): { name: string; vramGb: number } | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const devices = (raw as { devices?: unknown }).devices
  if (!Array.isArray(devices) || devices.length === 0) return undefined
  const first = devices[0]
  if (first === null || typeof first !== 'object') return undefined
  const device = first as { name?: unknown; vram_total?: unknown }
  const name = typeof device.name === 'string' ? device.name : 'GPU'
  const total = typeof device.vram_total === 'number' ? device.vram_total : 0
  return { name, vramGb: Math.round((total / 1024 ** 3) * 10) / 10 }
}

/**
 * 跑一次自检。
 *
 * 任何一个步骤抛错都只影响它自己那一项 —— 自检本身绝不能因为"查不到"而整体失败。
 *
 * @param deps - 注入的探测能力。
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const items: DoctorItem[] = []

  // 1. 服务是否在线
  let raw: unknown = null
  let serviceOk = false
  try {
    raw = await deps.systemStats()
    serviceOk = true
  } catch {
    serviceOk = false
  }
  items.push(serviceOk
    ? { id: 'service', title: 'ComfyUI 服务', level: 'ok', detail: `已连上 ${deps.baseUrl}` }
    : {
      id: 'service',
      title: 'ComfyUI 服务',
      level: 'fail',
      detail: `连不上 ${deps.baseUrl}`,
      fix: '确认 ComfyUI 已启动（或工作台配置里 autoStart / startCommand 正确），再点「启动 ComfyUI」。',
    })

  // 2. 本机模型
  let objectInfo: unknown = null
  try {
    objectInfo = await deps.objectInfo()
  } catch {
    objectInfo = null
  }
  const checkpoints = enumOf(objectInfo, 'CheckpointLoaderSimple', 'ckpt_name')
  items.push(checkpoints.length > 0
    ? { id: 'models', title: '可用模型', level: 'ok', detail: `检测到 ${checkpoints.length} 个 checkpoint` }
    : {
      id: 'models',
      title: '可用模型',
      level: objectInfo === null ? 'warn' : 'fail',
      detail: objectInfo === null ? '拿不到节点定义，无法确认模型' : '一个 checkpoint 都没检测到',
      fix: '把 .safetensors / .ckpt 放进 ComfyUI 的 models/checkpoints，然后重跑自检。',
    })

  // 3. 工作流库
  let count = 0
  try {
    count = deps.workflowCount()
  } catch {
    count = 0
  }
  items.push(count > 0
    ? { id: 'workflows', title: '工作流模板', level: 'ok', detail: `已启用 ${count} 个` }
    : {
      id: 'workflows',
      title: '工作流模板',
      level: 'warn',
      detail: '工作流库是空的',
      fix: '用「一键生成基础模板」按本机模型生成文生图 / 图生图 / 局部重绘，或从 ComfyUI 导出一份导入。',
    })

  // 4. 输出目录
  let writable = true
  try {
    deps.assertWritable(deps.outputDir)
  } catch {
    writable = false
  }
  items.push(writable
    ? { id: 'output', title: '产物目录', level: 'ok', detail: deps.outputDir }
    : {
      id: 'output',
      title: '产物目录',
      level: 'fail',
      detail: `${deps.outputDir} 不可写`,
      fix: '改配置里的 outputDir，或给它写权限。',
    })

  // 5. 显存（拿不到不算错）
  const gpu = gpuSummary(raw)
  items.push(gpu === undefined
    ? { id: 'gpu', title: '显存', level: 'warn', detail: '读不到显卡信息（不影响出图）' }
    : {
      id: 'gpu',
      title: '显存',
      level: gpu.vramGb >= 6 ? 'ok' : 'warn',
      detail: `${gpu.name} · ${gpu.vramGb} GB`,
      ...(gpu.vramGb >= 6 ? {} : { fix: '显存偏小，SDXL 可能 OOM；可以改用 SD1.5 或更小的分辨率。' }),
    })

  return { ok: items.every(item => item.level !== 'fail'), items }
}

/** 可以一键生成的开箱模板。 */
export type BootstrapKind = 'txt2img' | 'img2img' | 'inpaint'

/** 生成结果。 */
export interface BootstrapResult {
  /** 新写入的模板 id。 */
  created: string[]
  /** 已存在而跳过的模板 id。 */
  skipped: string[]
  /** 生成不出来的原因（例如没有模型）。 */
  blocked?: string
}

/**
 * 造一份最小可用的文生图 API 工作流。
 *
 * 节点顺序刻意保持"最常见的默认值"：20 步、euler、normal、CFG 7 —— 不是最优参数，
 * 但它是社区默认值，用户第一次跑出来能对得上预期。
 *
 * @param checkpoint - `ckpt_name` 里的一项。
 */
export function txt2imgWorkflow(checkpoint: string): Record<string, unknown> {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal',
        denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['8', 0] } },
  }
}

/**
 * 造一份最小可用的图生图 API 工作流（denoise 0.6）。
 *
 * @param checkpoint - `ckpt_name` 里的一项。
 */
export function img2imgWorkflow(checkpoint: string): Record<string, unknown> {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    10: { class_type: 'LoadImage', inputs: { image: '' } },
    11: { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal',
        denoise: 0.6, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['8', 0] } },
  }
}

/**
 * 造一份最小可用的局部重绘 API 工作流。
 *
 * @param checkpoint - `ckpt_name` 里的一项。
 */
export function inpaintWorkflow(checkpoint: string): Record<string, unknown> {
  return {
    ...img2imgWorkflow(checkpoint),
    // 局部重绘 = 图生图 + 噪声蒙版；denoise 要够高，否则蒙版区几乎不变
    12: { class_type: 'LoadImageMask', inputs: { image: '', channel: 'alpha' } },
    13: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['11', 0], mask: ['12', 0] } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal',
        denoise: 0.85, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['13', 0],
      },
    },
  }
}

/** 模板清单：id、标题、用途说明与生成器。 */
const TEMPLATES: Array<{
  kind: BootstrapKind
  id: string
  title: string
  note: string
  build: (checkpoint: string) => Record<string, unknown>
}> = [
  { kind: 'txt2img', id: 'quick-txt2img', title: '快速文生图', note: '最小可用文生图：填 vars.prompt 就能跑。', build: txt2imgWorkflow },
  { kind: 'img2img', id: 'quick-img2img', title: '快速图生图', note: '带一张参考图重绘（denoise 0.6）。vars.image 要填 ComfyUI 里的输入图名。', build: img2imgWorkflow },
  { kind: 'inpaint', id: 'quick-inpaint', title: '快速局部重绘', note: '图 + 蒙版重绘（denoise 0.85）。vars.image / vars.mask 都要填。', build: inpaintWorkflow },
]

/**
 * 按本机模型生成基础模板。
 *
 * 已存在的同名模板**跳过**，绝不覆盖 —— 用户可能已经改过或导入过同 id 的模板。
 *
 * @param options - 目标目录、可用 checkpoint 与要生成的种类。
 */
export function bootstrapWorkflows(options: {
  dir: string
  checkpoints: readonly string[]
  kinds?: readonly BootstrapKind[]
}): BootstrapResult {
  const checkpoint = options.checkpoints[0]
  if (checkpoint === undefined || checkpoint === '') {
    return { created: [], skipped: [], blocked: '没有可用的 checkpoint，先放一个模型进 models/checkpoints。' }
  }

  const wanted = typeof options.kinds === 'undefined' ? undefined : new Set(options.kinds)
  const created: string[] = []
  const skipped: string[] = []

  try {
    fs.mkdirSync(options.dir, { recursive: true })
  } catch {
    return { created: [], skipped: [], blocked: `工作流目录不可写：${options.dir}` }
  }

  for (const template of TEMPLATES) {
    if (wanted !== undefined && !wanted.has(template.kind)) continue
    const file = path.join(options.dir, `${template.id}.json`)
    if (fs.existsSync(file)) {
      skipped.push(template.id)
      continue
    }
    try {
      fs.writeFileSync(file, `${JSON.stringify(template.build(checkpoint), null, 2)}\n`, 'utf8')
      fs.writeFileSync(
        path.join(options.dir, `${template.id}.meta.json`),
        `${JSON.stringify({ title: template.title, note: template.note, enabled: true }, null, 2)}\n`,
        'utf8',
      )
      created.push(template.id)
    } catch {
      // 单个写失败不连累其余
    }
  }

  return { created, skipped }
}
