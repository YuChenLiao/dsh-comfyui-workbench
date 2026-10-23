import fs from 'node:fs'
import path from 'node:path'

import { ensureDir } from '../host/paths.js'
import { detectFormat, formatHint } from './detect.js'
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
 * 只保留字母数字与 `-_`：id 会进 URL 与文件路径，放开字符集等于开后门。
 */
export function sanitizeId(name: string): string {
  const base = path.basename(name, path.extname(name))
  const cleaned = base.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return cleaned === '' ? 'workflow' : cleaned.slice(0, 64)
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

/**
 * 导入一个工作流文件。
 *
 * 只接受 API 格式：UI 格式要提交必须先做图转换，v0.1 不做 —— 与其猜错，不如
 * 让用户在 ComfyUI 里重新导出。重复导入同一 id 会覆盖模板，但保留已有的
 * schema / meta（那是人工维护的内容）。
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

  const format = detectFormat(raw)
  if (format !== 'api') throw new WorkflowFormatError(formatHint(format))

  const id = sanitizeId(sourcePath)
  const workflow = raw as ApiWorkflow
  writeWorkflow(dir, id, workflow)
  const entry = readEntry(dir, id)
  if (entry === undefined) throw new WorkflowFormatError('导入后读不回这份工作流，请检查文件权限。')
  return { id, surface: entry.surface }
}

/** 删除一份工作流及其附属文件。 */
export function removeWorkflow(dir: string, id: string): boolean {
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
