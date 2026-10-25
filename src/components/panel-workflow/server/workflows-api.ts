import { availableModels, missingModels, suggestModels } from '../../../shared/comfy/index.js'
import { listEntries, readEntry, writeMeta } from '../../../shared/workflow/index.js'
import type { WorkflowIOSurface } from '../../../shared/workflow/types.js'
import { readJsonBody, sendJson } from '../../../shared/http/respond.js'

/** 列表项：UI 与模型看到的是同一份数据，只是用法不同。 */
function toListItem(
  surface: WorkflowIOSurface,
  available: ReadonlySet<string> | null,
): Record<string, unknown> {
  const primary = surface.models.find(model => model.primary === true) ?? surface.models[0]
  return {
    workflowId: surface.workflowId,
    title: surface.title,
    description: surface.description,
    undescribed: surface.description === '',
    model: primary?.name ?? '',
    modelKind: primary?.kind ?? '',
    otherModels: surface.models.filter(model => model !== primary).map(model => model.name),
    inputKinds: [...new Set(surface.inputs.map(slot => slot.type))],
    inputCount: surface.inputs.length,
    basicCount: surface.inputs.filter(slot => slot.group === 'basic').length,
    outputs: surface.outputs.map(slot => ({ kind: slot.kind, count: slot.count })),
    nodes: surface.meta.nodeCount,
    workflowHash: surface.workflowHash,
    enabled: surface.enabled,
    ...(available === null
      ? {}
      : (() => {
          const missing = missingModels(surface.models, available)
          if (missing.length === 0) return {}
          const primary = surface.models.find(model => model.primary === true) ?? surface.models[0]
          return {
            missingModels: missing,
            modelHint: `本机没有：${missing.join('、')}。可用的替代：${suggestModels(available, primary?.kind ?? 'checkpoint').join('、') || '（一个都没有）'}`,
          }
        })()),
  }
}

/**
 * `GET /comfyui-workbench/api/workflows`：IO 面列表。
 *
 * 只给 IO 面，不给节点图 —— 浏览器端不需要拓扑，给它等于把几十 KB JSON
 * 送进内存与 devtools。节点细节走工具（`comfyui_workflow_inspect`）。
 */
export async function handleWorkflowList(
  dir: string,
  _url: URL,
  res: import('node:http').ServerResponse,
  available: ReadonlySet<string> | null,
): Promise<void> {
  const { entries, broken } = listEntries(dir)
  sendJson(res, 200, {
    ok: true,
    count: entries.length,
    workflows: entries.map(entry => toListItem(entry.surface, available)),
    ...(broken.length > 0 ? { broken } : {}),
  })
}

/**
 * `GET /comfyui-workbench/api/workflows/{id}`：单份 IO 面（含完整输入槽位）。
 *
 * 客户端据此渲染表单：basic 段铺开，advanced 折叠。
 */
export function handleWorkflowDetail(dir: string, id: string, res: import('node:http').ServerResponse): void {
  const entry = readEntry(dir, id)
  if (entry === undefined) {
    sendJson(res, 404, { ok: false, error: 'no-workflow', message: `没有这个工作流：${id}` })
    return
  }
  sendJson(res, 200, { ok: true, surface: entry.surface })
}

/** `/workflows` 的后缀是否是"取单份"（`/workflows/{id}`）。 */
export function workflowIdFromPath(sub: string): string | undefined {
  const prefix = '/workflows/'
  if (!sub.startsWith(prefix)) return undefined
  const rest = sub.slice(prefix.length)
  if (rest === '' || rest.includes('/')) return undefined
  try {
    return decodeURIComponent(rest)
  } catch {
    return undefined
  }
}

/**
 * `POST /comfyui-workbench/api/workflows/{id}`：改工作流的设置。
 *
 * 面板只做三件事：开关可用性、写用途备注、改标题。这些落在 `<id>.meta.json`，
 * 与模型侧的 `comfyui_workflow_edit` 写的是同一份文件（updatedBy 区分来源）。
 */
export async function handleWorkflowUpdate(
  dir: string,
  id: string,
  res: import('node:http').ServerResponse,
  req: import('node:http').IncomingMessage,
): Promise<void> {
  const entry = readEntry(dir, id)
  if (entry === undefined) {
    sendJson(res, 404, { ok: false, error: 'not-found', message: `没有这个工作流：${id}` })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: 'bad-body', message: error instanceof Error ? error.message : String(error) })
    return
  }
  const bag = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}

  const next = {
    ...(entry.meta ?? {}),
    ...(typeof bag.title === 'string' ? { title: bag.title.trim() } : {}),
    ...(typeof bag.description === 'string' ? { description: bag.description.trim() } : {}),
    ...(typeof bag.enabled === 'boolean' ? { enabled: bag.enabled } : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: 'user' as const,
  }
  writeMeta(dir, id, next)

  const updated = readEntry(dir, id)
  sendJson(res, 200, {
    ok: true,
    workflowId: id,
    enabled: updated?.surface.enabled ?? true,
    title: updated?.surface.title ?? '',
    description: updated?.surface.description ?? '',
  })
}
