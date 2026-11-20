import fs from 'node:fs'
import path from 'node:path'

import { ensureDir } from '../host/paths.js'
import { detectFormat, formatHint } from './detect.js'
import { convertUiToApi } from './from-ui.js'
import type { UiWorkflow } from './from-ui.js'
import { buildSurface } from './surface.js'
import type { ApiWorkflow, WorkflowIOSurface, WorkflowMeta, WorkflowSchema } from './types.js'

/** 格式不合法：带用户可执行的指引。 */
export class WorkflowFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowFormatError'
  }
}

/** 仓库里的一份工作流。 */
export interface WorkflowEntry {
  id: string
  workflow: ApiWorkflow
  schema: WorkflowSchema | undefined
  meta: WorkflowMeta | undefined
  surface: WorkflowIOSurface
}

/**
 * 文件名 → 稳定 id。
 *
 * 保留各语言的字母与数字（`\p{L}\p{N}`），丢掉路径分隔符、引号、控制字符这些
 * 真正危险的东西。早期版本只留 ASCII，结果 `MOSS-Image_文生图` 与 `MOSS-Image_图生图`
 * 会被压成同一个 id 互相覆盖 —— 中文名的工作流直接丢数据。
 */
export function sanitizeId(name: string): string {
  const base = path.basename(name, path.extname(name))
  const cleaned = base
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  // 按**码位**截断而不是 UTF-16 码元：`slice(0,64)` 会把星平面字符切成孤代理，
  // 那个 id 回到前端再 `encodeURIComponent` 会抛 URIError。
  return cleaned === '' ? 'workflow' : [...cleaned].slice(0, 64).join('').replace(/-+$/g, '')
}

/** 仓库路径。 */
export function pathsOf(dir: string, id: string): { workflow: string; schema: string; meta: string } {
  return {
    workflow: path.join(dir, `${id}.json`),
    schema: path.join(dir, `${id}.schema.json`),
    meta: path.join(dir, `${id}.meta.json`),
  }
}

/** 读一个 JSON 文件，不存在或损坏都返回 undefined（坏文件不该让整个列表失败）。 */
function readJson<T>(file: string): T | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}

/** 列出仓库里的工作流 id（按文件名排序）。 */
export function listWorkflowIds(dir: string): string[] {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter(name => name.endsWith('.json') && !name.endsWith('.schema.json') && !name.endsWith('.meta.json'))
    .map(name => name.slice(0, -'.json'.length))
    .sort()
}

/**
 * 读一份工作流并组装 IO 面。
 *
 * @param dir - 工作流目录。
 * @param id - 工作流 id。
 */
export function readEntry(dir: string, id: string): WorkflowEntry | undefined {
  const files = pathsOf(dir, id)
  const workflow = readJson<ApiWorkflow>(files.workflow)
  if (workflow === undefined) return undefined
  // 目录里可能混着别的 JSON（手滑放进来的、UI 格式的）。不是 API 格式就当坏条目，
  // 让 listEntries 报出来，而不是在渲染 IO 面时才炸。
  if (detectFormat(workflow) !== 'api') return undefined
  const schema = readJson<WorkflowSchema>(files.schema)
  const meta = readJson<WorkflowMeta>(files.meta)
  return { id, workflow, schema, meta, surface: buildSurface({ workflowId: id, workflow, schema, meta }) }
}

/** 列出全部工作流（坏条目跳过，并在返回值里报数量）。 */
export function listEntries(dir: string): { entries: WorkflowEntry[]; broken: string[] } {
  const entries: WorkflowEntry[] = []
  const broken: string[] = []
  for (const id of listWorkflowIds(dir)) {
    const entry = readEntry(dir, id)
    if (entry === undefined) broken.push(id)
    else entries.push(entry)
  }
  return { entries, broken }
}

/** 写一份工作流模板。schema / meta 已存在时不覆盖（保护手写声明）。 */
export function writeWorkflow(dir: string, id: string, workflow: ApiWorkflow): void {
  ensureDir(dir)
  fs.writeFileSync(pathsOf(dir, id).workflow, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8')
}

/** 写 schema（整体替换：这是人写的文件，以最后一次写入为准）。 */
export function writeSchema(dir: string, id: string, schema: WorkflowSchema): void {
  ensureDir(dir)
  fs.writeFileSync(pathsOf(dir, id).schema, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
}

/** 写 meta（用户与模型都可写，带 updatedBy 溯源）。 */
export function writeMeta(dir: string, id: string, meta: WorkflowMeta): void {
  ensureDir(dir)
  const merged: WorkflowMeta = {
    ...meta,
    updatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(pathsOf(dir, id).meta, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
}

/** 同名工作流已存在且调用方没有显式要求覆盖。 */
export class WorkflowExistsError extends Error {
  readonly id: string

  constructor(id: string) {
    super(`已存在同名工作流：${id}。覆盖会替换模板（保留备注与 schema），需要显式确认。`)
    this.name = 'WorkflowExistsError'
    this.id = id
  }
}

/**
 * 预设表归一化：只接受"名字 → 对象"的形状。
 *
 * `<id>.meta.json` 是手改得动的文件，写错一层（`presets: { foo: "bar" }`）
 * 不该让运行在合并阶段崩，只该让那个预设不可用。
 *
 * **导出是必须的**：列表侧（`comfyui_workflow`）与运行侧（`comfyui_run`）各自归一化
 * 的话，会出现"清单里列着 `broken`、点了却说没有这个预设"—— 模型照着点、撞墙、还不知道为什么。
 * `Object.hasOwn` 也不能省：`loaded.presets['toString']` 会命中原型链，静默当空预设通过。
 */
export function normalizedPresets(raw: unknown): Record<string, Record<string, unknown>> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && Array.isArray(value) === false) {
      out[name] = value as Record<string, unknown>
    }
  }
  return out
}

/** 这个预设名是否真的存在（不踩原型链）。 */
export function hasPreset(presets: Record<string, unknown>, name: string): boolean {
  return Object.hasOwn(presets, name)
}

/**
 * 导入一份**已经解析好**的工作流 JSON。
 *
 * 面板的「上传 / 粘贴导入」走这条：它拿到的是内存里的对象，没有文件路径。
 * `importWorkflowFile` 与它共用这段逻辑 —— 否则 CLI 与 HTTP 会各写一份校验。
 *
 * **接受两种格式**：
 * - API 格式 → 直接落盘
 * - UI 格式（ComfyUI 界面工程文件）→ 需要 `options.objectInfo` 才能做图转换；
 *   拿不到就抛 {@link WorkflowFormatError}（提示去 ComfyUI 里 Export (API)），
 *   转换失败同样抛它 —— 绝不写半成品。
 *
 * **同名时的两种行为**：
 * - `overwrite !== true`（面板默认）→ 抛 {@link WorkflowExistsError}，让调用方先确认。
 *   面板把导入做成一次点击，不做这一步的话误覆盖就是静默丢数据。
 * - `overwrite === true` → 覆盖模板，但**保留** `.meta.json` / `.schema.json`；
 *   旧模板会被备份成 `<id>.json.bak`（只留最近一份）。
 *
 * @param dir - 工作流目录。
 * @param raw - 解析后的 JSON（未校验）。
 * @param nameHint - 用来生成 id 的字符串（文件名或用户给的名字）。
 * @param options - `overwrite` 为真才允许覆盖同名；`objectInfo` 只在 UI 格式转换时需要。
 * @returns id、输入面、是否覆盖了同名模板，以及 UI 转换产生的说明（非 UI 格式为空数组）。
 */
export function importWorkflowValue(
  dir: string,
  raw: unknown,
  nameHint: string,
  options: { overwrite?: boolean; objectInfo?: Record<string, unknown> } = {},
): { id: string; surface: WorkflowIOSurface; replaced: boolean; conversionNotes: string[] } {
  let value: unknown = raw
  let conversionNotes: string[] = []

  const format = detectFormat(raw)
  if (format === 'ui') {
    // UI 格式（界面工程文件）只有拿到 `/object_info` 才能可靠地做图转换：
    // 节点定义里有 input 顺序与 widget 类型，缺了就必然拼错。
    // 调用方拿不到（ComfyUI 没起）时仍然回到那句"去 Export (API)"，不猜。
    if (options.objectInfo === undefined) throw new WorkflowFormatError(formatHint(format))
    let conversion: ReturnType<typeof convertUiToApi>
    try {
      conversion = convertUiToApi(raw as UiWorkflow, options.objectInfo)
    } catch (error) {
      // 转换器内部对畸形结构已经尽量跳过并记 note；真抛出来的都是没预料到的形状 ——
      // 那也仍然是"这份 JSON 不对"，不是服务端故障（500 会把内部栈回给浏览器）。
      throw new WorkflowFormatError(
        `UI 格式转换失败：${error instanceof Error ? error.message : String(error)}。`
          + '请在 ComfyUI 里用「Export (API)」导出后再导入。',
      )
    }
    value = conversion.workflow
    conversionNotes = conversion.notes
    // 转换是尽力而为：转完再验一次格式，失败就不写盘（宁可报错，不塞半成品）
    if (detectFormat(value) !== 'api') {
      throw new WorkflowFormatError('UI 格式转换后仍不是合法的 API 工作流，可能是节点定义缺失。请在 ComfyUI 里用「Export (API)」导出后再导入。')
    }
  } else if (format !== 'api') {
    throw new WorkflowFormatError(formatHint(format))
  }

  const id = sanitizeId(nameHint)
  const target = pathsOf(dir, id).workflow
  const replaced = fs.existsSync(target)
  if (replaced && options.overwrite !== true) throw new WorkflowExistsError(id)
  if (replaced) {
    // 只留最近一份备份：覆盖是面板上的一个点击，至少要能回退一次
    try {
      fs.copyFileSync(target, `${target}.bak`)
    } catch {
      // 备份失败不该阻止导入本身
    }
  }

  writeWorkflow(dir, id, value as ApiWorkflow)
  const entry = readEntry(dir, id)
  if (entry === undefined) throw new WorkflowFormatError('导入后读不回这份工作流，请检查文件权限。')
  return { id, surface: entry.surface, replaced, conversionNotes }
}

/**
 * 导入一个工作流文件（CLI 用）。
 *
 * @param dir - 工作流目录。
 * @param sourcePath - 源文件路径。
 */
export function importWorkflowFile(dir: string, sourcePath: string): { id: string; surface: WorkflowIOSurface } {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  } catch (error) {
    throw new WorkflowFormatError(`读不了这个 JSON：${error instanceof Error ? error.message : String(error)}`)
  }

  // CLI 一直是「导入即覆盖」的语义（重新导出一份同名模板很常见），这里显式放行
  const { id, surface } = importWorkflowValue(dir, raw, sourcePath, { overwrite: true })
  return { id, surface }
}

/**
 * 工作流 id 是否安全。
 *
 * id 会被 `path.join(dir, '<id>.json')` 拼进文件路径，所以它必须是**单段**：
 * 不含分隔符、不是 `.` / `..`、不以 `.` 开头（避开隐藏文件与 `.bak`）。
 *
 * 校验必须在 `decodeURIComponent` **之后**：先判原始片段再解码的话，
 * `%2f` 能绕过那个判断（实测 `DELETE /workflows/..%2fvictim` 会删到工作流目录外）。
 */
export function isSafeWorkflowId(id: string): boolean {
  if (id === '' || id === '.' || id === '..' || id.startsWith('.')) return false
  return /[/\\\u0000-\u001f]/.test(id) === false
}

/** 删除一份工作流及其附属文件。 */
export function removeWorkflow(dir: string, id: string): boolean {
  // 唯一的删除入口：非法 id 一律不碰文件系统（上层也校验，这里是第二道）
  if (isSafeWorkflowId(id) === false) return false
  const files = pathsOf(dir, id)
  let removed = false
  for (const file of [files.workflow, files.schema, files.meta]) {
    try {
      fs.unlinkSync(file)
      removed = true
    } catch {
      // 本来就不存在
    }
  }
  return removed
}
