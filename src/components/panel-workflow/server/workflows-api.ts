import { availableModels, missingModels, suggestModels } from '../../../shared/comfy/index.js'
import { importWorkflowValue, listEntries, readEntry, WorkflowExistsError, WorkflowFormatError, writeMeta } from '../../../shared/workflow/index.js'
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
    // 面板的"拿这张图去出图"要靠它知道往哪个键里传图。
    // 注意：工具侧那份 toListItem **不产出** imageSlots，它只在 `inputs=image`
    // 的过滤分支里临时挂上去；面板走的是这里，必须自带 —— 漏了就让面板永远列不出候选。
    imageSlots: surface.inputs.filter(slot => slot.type === 'image').map(slot => slot.name),
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
  url: URL,
  res: import('node:http').ServerResponse,
  available: ReadonlySet<string> | null,
): Promise<void> {
  const { entries, broken } = listEntries(dir)
  // `?inputs=image` 只回需要图片输入的工作流 —— 面板用它列"能吃图的工作流"。
  const wantInput = (url.searchParams.get('inputs') ?? '').trim().toLowerCase()
  const filtered = wantInput === ''
    ? entries
    : entries.filter(entry => entry.surface.inputs.some(slot => slot.type.toLowerCase() === wantInput))
  sendJson(res, 200, {
    ok: true,
    count: filtered.length,
    workflows: filtered.map(entry => toListItem(entry.surface, available)),
    ...(broken.length > 0 ? { broken } : {}),
    ...(wantInput !== '' && filtered.length === 0
      ? { hint: `本机没有需要 ${wantInput} 输入的工作流。` }
      : {}),
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

/**
 * `POST /comfyui-workbench/api/workflows/import`：贴一份 JSON 导入工作流。
 *
 * **为什么要独立路径**：`POST /workflows` 是批量导出 ZIP，不能复用。而 `/workflows/import`
 * 必须注册进路由的 `exact` 表 —— 否则会被前缀路由当成 id=`import` 的工作流去读详情，
 * 返回 `no-workflow` 而不是导入结果。
 *
 * 请求体 `{ name?: string, workflow: object }`：`name` 只用来生成 id（缺省 `workflow`），
 * `workflow` 是**已解析**的对象——前端负责 `JSON.parse` 并给出语法错误。
 *
 * 只接受 API 格式（UI 格式需要图转换，与 CLI 一致：让用户回 ComfyUI 重新导出）。
 * 同名导入覆盖模板但保留 `.schema.json` / `.meta.json`，所以响应里带 `replaced`。
 *
 * @param dir - 工作流目录。
 */
export async function handleWorkflowImport(
  dir: string,
  res: import('node:http').ServerResponse,
  req: import('node:http').IncomingMessage,
): Promise<void> {
  let body: Record<string, unknown>
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: 'bad-body', message: error instanceof Error ? error.message : String(error) })
    return
  }

  const workflow = body.workflow
  if (workflow === null || workflow === undefined) {
    sendJson(res, 400, {
      ok: false,
      error: 'bad-body',
      message: '需要 workflow：把 API 格式工作流的 JSON 对象放在这个字段里。',
    })
    return
  }

  // 缺省名带时间戳：固定用 `workflow` 的话，不填名字的第二次导入会静默覆盖上一次。
  // 用户显式填了名字才进入"可能撞名"的分支，那条路要经过 409 + 确认。
  const nameHint = typeof body.name === 'string' && body.name.trim() !== ''
    ? body.name.trim()
    : `workflow-${Date.now().toString(36)}`
  try {
    const result = importWorkflowValue(dir, workflow, nameHint, { overwrite: body.overwrite === true })
    sendJson(res, 200, {
      ok: true,
      workflowId: result.id,
      // 覆盖过就说明模板被换了（备注与 schema 保留），调用方需要知道这点
      replaced: result.replaced,
      surface: result.surface,
    })
  } catch (error) {
    // 同名：让前端确认后再带 overwrite 重发。面板把导入做成一次点击，
    // 不确认就覆盖等于静默丢数据。
    if (error instanceof WorkflowExistsError) {
      sendJson(res, 409, {
        ok: false,
        error: 'already-exists',
        workflowId: error.id,
        message: error.message,
      })
      return
    }
    // 格式不对：`formatHint` 的文案已经写明「去 ComfyUI 用 Export (API) 重新导出」
    if (error instanceof WorkflowFormatError) {
      sendJson(res, 400, { ok: false, error: 'bad-workflow', message: error.message })
      return
    }
    // 其余是写盘失败（EACCES / ENOSPC / 目录不可写）—— 服务端问题，不是请求问题
    sendJson(res, 500, {
      ok: false,
      error: 'import-failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
