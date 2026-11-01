import type { Settings } from '../../../shared/host/config.js'
import { effectiveProgressStream } from '../../../shared/host/toggles.js'
import type { TogglePatch, Toggles } from '../../../shared/host/toggles.js'
import { readJsonBody, sendJson } from '../../../shared/http/respond.js'

/** 面板上可切开关的读写接口。 */
export interface ToggleAccess {
  read: () => Toggles
  write: (patch: TogglePatch) => Toggles
}

/**
 * `GET|POST /comfyui-workbench/api/config`：界面需要的配置 + 面板开关。
 *
 * GET 只暴露路径与地址，不暴露 headers 之类的凭据。
 * POST 写**面板开关**（落在插件数据目录的 `settings.json`，改完下一次提交就生效），
 * 不碰 profile 里的 `cordis.patch.yml` —— 那是启动配置，改它要重启。
 */
export function createConfigHandler(deps: {
  settings: Settings
  outputDir: string
  workflowsDir: string
  /** 产物目录是怎么定下来的：配置 / 工作区 / 数据目录。 */
  outputSource?: 'config' | 'env' | 'workingDirectory' | 'service' | 'cwd' | 'data'
  /** 产物目录探测的取证记录（诊断用：看得出工作区为什么没识别到）。 */
  workspaceProbe?: Record<string, unknown>
  /** 运行时开关；不给就只报告配置里的默认值（不可改）。 */
  toggles?: ToggleAccess
  /** 惰性取诊断信息（工具在路由之后才注册，构造时求值会拿到空表）。 */
  getDiagnostics?: () => {
    components?: Record<string, boolean>
    tools?: { registered: string[]; failed: Array<{ name: string; message: string }>; skipped: string[] }
  }
}): (url: URL, res: import('node:http').ServerResponse, req: import('node:http').IncomingMessage) => Promise<void> {
  /** 开关的当前有效值 + 它来自哪里（面板改过就是 toggle，否则是配置）。 */
  const togglesView = (): { progressStream: boolean; progressStreamSource: 'toggle' | 'config' } => {
    const stored = deps.toggles?.read() ?? {}
    return {
      progressStream: effectiveProgressStream(deps.settings, stored),
      progressStreamSource: stored.progressStream === undefined ? 'config' : 'toggle',
    }
  }

  const snapshot = (): Record<string, unknown> => {
    const diagnostics = deps.getDiagnostics?.() ?? {}
    return {
      baseUrl: deps.settings.baseUrl,
      outputDir: deps.outputDir,
      outputSource: deps.outputSource ?? 'config',
      workflowsDir: deps.workflowsDir,
      runMode: deps.settings.runMode,
      returnImages: deps.settings.returnImages,
      timeoutMs: deps.settings.timeoutMs,
      // 面板开关：`progressStreamSource` 让界面说清"这是面板改的还是配置来的"
      toggles: togglesView(),
      ...(deps.workspaceProbe === undefined ? {} : { workspaceProbe: deps.workspaceProbe }),
      ...(diagnostics.components === undefined ? {} : { components: diagnostics.components }),
      ...(diagnostics.tools === undefined ? {} : { tools: diagnostics.tools }),
    }
  }

  return async (_url, res, req) => {
    // 这条路径在 router 里走 selfManaged（GET 读、POST 写），方法校验不经过通用层，
    // 所以这里自己挡：PUT/DELETE 之类不该落到"当 GET 处理"上（那会返回 200 + ok:true，
    // 客户端以为保存成功、实际什么都没写）。与 `/terminal` 同一个做法。
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这个接口只接受 GET / POST。' })
      return
    }

    if (method === 'POST') {
      if (deps.toggles === undefined) {
        sendJson(res, 400, { ok: false, error: 'no-toggles', message: '这个部署没有开面板开关。' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(req)
      } catch {
        sendJson(res, 400, { ok: false, error: 'bad-body', message: '读不了请求体。' })
        return
      }
      const bag = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
      // 只认布尔；`null` 表示删掉覆盖、回退到配置默认值
      const patch: TogglePatch = {}
      if (typeof bag.progressStream === 'boolean') patch.progressStream = bag.progressStream
      else if (bag.progressStream === null) patch.progressStream = null
      else if (bag.progressStream !== undefined) {
        sendJson(res, 400, { ok: false, error: 'bad-body', message: 'progressStream 只接受布尔值或 null。' })
        return
      }
      if (patch.progressStream === undefined) {
        sendJson(res, 400, { ok: false, error: 'bad-body', message: '没有要改的开关。' })
        return
      }
      try {
        deps.toggles.write(patch)
      } catch (error) {
        sendJson(res, 200, { ok: false, error: 'write-failed', message: error instanceof Error ? error.message : String(error) })
        return
      }
      sendJson(res, 200, { ok: true, toggles: togglesView() })
      return
    }

    sendJson(res, 200, { ok: true, config: snapshot() })
  }
}
