import { availableModels, missingModels, suggestModels } from '../../../shared/comfy/index.js'
import { importWorkflowValue, isSafeWorkflowId, listEntries, readEntry, WorkflowExistsError, WorkflowFormatError, writeMeta } from '../../../shared/workflow/index.js'
import { detectFormat } from '../../../shared/workflow/detect.js'
import type { WorkflowIOSurface } from '../../../shared/workflow/types.js'
import { readPngTextChunksFromBuffer } from '../../../shared/media/png-text.js'
import { readJsonBody, readRawBody, sendJson } from '../../../shared/http/respond.js'

/** PNG 导入的体积上限：4K 上采样出的无损 PNG 能到 40MB，8MB 会挡掉真实图。 */
const PNG_BODY_LIMIT = 64 * 1024 * 1024

/**
 * 列表项（**面板侧**）。
 *
 * 与模型侧那份（`tool-generate/tools/workflow-list.ts` 的 `toModelItem`）字段已经分叉：
 * 面板要 `imageSlots`（"拿这张图去出图"往哪个键传图）与 `basicCount`（分组计数），
 * 模型要 `inputs` 明细。强行统一成一个胖形状两边都不满意，所以分开、各自命名，
 * 由 `tests/workflow-list-shape.test.mjs` 钉住"共同字段不能漂"。
 */
export function toPanelItem(
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
 * 送进内存与 devtools。节点细节走工具（`comfyui_workflow`）。
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
    workflows: filtered.map(entry => toPanelItem(entry.surface, available)),
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
  if (rest === '') return undefined
  let id: string
  try {
    id = decodeURIComponent(rest)
  } catch {
    return undefined
  }
  // **必须在解码之后校验**：先判 `rest.includes('/')` 时 `%2f` 能绕过它，
  // 于是 `..%2fvictim` 解码成 `../victim` 交给 `path.join` —— 实测能删到目录外。
  return isSafeWorkflowId(id) ? id : undefined
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
 * 导入接口的依赖。
 *
 * **为什么要独立路径**：`POST /workflows` 是批量导出 ZIP，不能复用。而 `/workflows/import`
 * 必须注册进路由的 `exact` 表 —— 否则会被前缀路由当成 id=`import` 的工作流去读详情，
 * 返回 `no-workflow` 而不是导入结果。
 */
export interface WorkflowImportDeps {
  /** 工作流目录。 */
  dir: string
  /**
   * 拿 `/object_info` —— UI 格式（界面工程文件）做图转换必须有它。
   *
   * 由路由层注入（组件内不认识 `ComfyClient`）。拿不到时返回 undefined，
   * 导入就退回那句"请用 Export (API)"，不猜节点顺序。
   */
  objectInfo?: () => Promise<Record<string, unknown> | undefined>
}

/** 把导入失败翻成响应。三条分支与错误类型一一对应。 */
function sendImportError(res: import('node:http').ServerResponse, error: unknown): void {
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

/** 拿 object_info；失败就当拿不到（离线时 UI 格式本来就转换不了）。 */
async function safeObjectInfo(deps: WorkflowImportDeps): Promise<Record<string, unknown> | undefined> {
  if (deps.objectInfo === undefined) return undefined
  try {
    const info = await deps.objectInfo()
    // getter 返回 null / 数组时也不能往下传：`convertUiToApi` 会把它当对象用
    return info !== null && typeof info === 'object' && Array.isArray(info) === false ? info : undefined
  } catch {
    return undefined
  }
}

/**
 * 从 ComfyUI 保存的 PNG 里导入工作流。
 *
 * ComfyUI 存图时会把工作流塞进 PNG 的文本块：`prompt` 是 **API 格式**（能直接提交），
 * `workflow` 是 **UI 格式**（要转换）。优先用 `prompt` —— 它不需要 `/object_info`，
 * 离线也能导。两者都没有（普通 PNG / 别的软件存的图）就明确拒绝。
 */
async function importFromPng(
  deps: WorkflowImportDeps,
  res: import('node:http').ServerResponse,
  req: import('node:http').IncomingMessage,
): Promise<void> {
  // 先按声明长度预判：4K 上采样的无损 PNG 能到 40MB，8MB 会把真实图挡在门外，
  // 而"图太大"和"图坏了"对用户是两件事 —— 前者给 413 和具体上限。
  const declared = Number(req.headers['content-length'] ?? '')
  const limitMb = Math.round(PNG_BODY_LIMIT / 1024 / 1024)
  if (Number.isFinite(declared) && declared > PNG_BODY_LIMIT) {
    sendJson(res, 413, { ok: false, error: 'too-large', message: `图片超过 ${limitMb}MB，无法导入。` })
    return
  }

  let buffer: Buffer
  try {
    buffer = await readRawBody(req, PNG_BODY_LIMIT)
  } catch (error) {
    // 没有 Content-Length 的流式上传只能靠读的时候兜底
    sendJson(res, 413, {
      ok: false,
      error: 'too-large',
      message: `图片超过 ${limitMb}MB，无法导入（${error instanceof Error ? error.message : String(error)}）。`,
    })
    return
  }

  const png = readPngTextChunksFromBuffer(buffer)
  if (png === undefined) {
    sendJson(res, 400, { ok: false, error: 'not-png', message: '这不是 PNG 图片。' })
    return
  }

  const apiChunk = png.chunks.find(chunk => chunk.keyword === 'prompt')
  const uiChunk = png.chunks.find(chunk => chunk.keyword === 'workflow')
  if (apiChunk === undefined && uiChunk === undefined) {
    sendJson(res, 400, {
      ok: false,
      error: 'no-workflow-in-png',
      message: '这张 PNG 里没有工作流。只有 ComfyUI 保存的图才带 prompt / workflow 文本块（普通截图或别的软件存的图没有）。',
    })
    return
  }

  /**
   * 候选块，按可靠性排序：`prompt`（执行过的 API 格式，离线可用）优先，
   * `workflow`（完整工程，需转换）兜底。
   *
   * **坏块不该让整次导入失败**：`prompt` 解析不出来时 `workflow` 往往是好的，
   * 直接放弃等于白白丢掉一份可用的工程文件。
   */
  const candidates: Array<{ source: 'png-api' | 'png-ui'; value: unknown }> = []
  if (apiChunk !== undefined) {
    try {
      const parsed: unknown = JSON.parse(apiChunk.value)
      if (detectFormat(parsed) === 'api') candidates.push({ source: 'png-api', value: parsed })
    } catch {
      // 这一块坏了，看下一块
    }
  }
  if (uiChunk !== undefined) {
    try {
      candidates.push({ source: 'png-ui', value: JSON.parse(uiChunk.value) })
    } catch {
      // 同上
    }
  }
  if (candidates.length === 0) {
    sendJson(res, 400, {
      ok: false,
      error: 'bad-workflow',
      message: 'PNG 里的工作流文本块不是合法的 API 工作流（也不是可解析的 JSON）。',
    })
    return
  }

  // 文件名可能是中文：HTTP 头只接受 latin1，所以前端用 encodeURIComponent 编过，
  // 这里解回来。解不开就用原文（不许因为一个名字把整次导入拒掉）。
  const headerName = req.headers['x-workflow-name']
  let fileName = typeof headerName === 'string' ? headerName.trim() : ''
  if (fileName !== '') {
    try {
      fileName = decodeURIComponent(fileName)
    } catch {
      // 保持原文
    }
  }
  const nameHint = fileName !== '' ? fileName : `png-${Date.now().toString(36)}`

  let lastError: unknown
  for (const candidate of candidates) {
    // UI 块才需要 object_info，而且只有轮到它时才去拉
    const objectInfo = candidate.source === 'png-ui' ? await safeObjectInfo(deps) : undefined
    try {
      const result = importWorkflowValue(deps.dir, candidate.value, nameHint, { objectInfo })
      sendJson(res, 200, {
        ok: true,
        workflowId: result.id,
        replaced: result.replaced,
        // 从哪条文本块来的：`png-api` 是执行过的图（不含静音/旁路节点），
        // `png-ui` 是完整工程（会走转换，可能有 notes）
        source: candidate.source,
        ...(result.conversionNotes.length === 0 ? {} : { conversionNotes: result.conversionNotes }),
        surface: result.surface,
      })
      return
    } catch (error) {
      // 同名要立刻说清：拿另一块硬试出别的结果是"默默换了份东西"
      if (error instanceof WorkflowExistsError) {
        sendImportError(res, error)
        return
      }
      lastError = error
    }
  }
  sendImportError(res, lastError)
}

/**
 * `POST /workflows/import`：导入一份工作流。
 *
 * 三种输入：
 * 1. JSON 体 `{ workflow, name, overwrite }` —— API 格式直接导入
 * 2. 同上但 `workflow` 是 **UI 格式** —— 能拿到 `/object_info` 就自动转换
 * 3. `Content-Type: image/png` —— 从 ComfyUI 保存的 PNG 里取工作流
 */
export async function handleWorkflowImport(
  deps: WorkflowImportDeps,
  res: import('node:http').ServerResponse,
  req: import('node:http').IncomingMessage,
): Promise<void> {
  const contentType = String(req.headers['content-type'] ?? '')
  if (contentType.includes('image/png')) {
    await importFromPng(deps, res, req)
    return
  }

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
      message: '需要 workflow：把工作流的 JSON 对象放在这个字段里（API 格式，或能转换的 UI 格式）。也可以直接上传 ComfyUI 保存的 PNG。',
    })
    return
  }

  // 缺省名带时间戳：固定用 `workflow` 的话，不填名字的第二次导入会静默覆盖上一次。
  // 用户显式填了名字才进入"可能撞名"的分支，那条路要经过 409 + 确认。
  const nameHint = typeof body.name === 'string' && body.name.trim() !== ''
    ? body.name.trim()
    : `workflow-${Date.now().toString(36)}`
  // **只有 UI 格式才去拉 object_info。** API 格式是绝大多数导入，不该为一次
  // 可能几十毫秒（冷缓存下可能吃满 3 秒）的探针买单 —— 而且 ComfyUI 没起时
  // 每次导入都会白等一轮超时。
  const objectInfo = detectFormat(workflow) === 'ui' ? await safeObjectInfo(deps) : undefined
  try {
    const result = importWorkflowValue(deps.dir, workflow, nameHint, {
      overwrite: body.overwrite === true,
      ...(objectInfo === undefined ? {} : { objectInfo }),
    })
    sendJson(res, 200, {
      ok: true,
      workflowId: result.id,
      // 覆盖过就说明模板被换了（备注与 schema 保留），调用方需要知道这点
      replaced: result.replaced,
      ...(result.conversionNotes.length === 0 ? {} : { conversionNotes: result.conversionNotes }),
      surface: result.surface,
    })
  } catch (error) {
    sendImportError(res, error)
  }
}
