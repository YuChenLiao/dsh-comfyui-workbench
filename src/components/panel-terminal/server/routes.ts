/**
 * 组件：用户面板 · ComfyUI 终端。
 *
 * 展示的是**命令行输出**（TUI），不是 GUI 截图 —— 用户想知道服务在干什么、
 * 卡在哪一步、模型加载到几成，这些只出现在终端里。
 *
 * 数据有两个来源：
 * - 本插件拉起的进程：直接接 stdout/stderr（实时，且日志里不会出现我们看不到的内容）
 * - 外部启动的实例（Desktop 自己起的那些）：stdout 在别人的终端里，改读 ComfyUI 写的
 *   `user/comfyui.log`。两条路只走一条 —— ComfyUI 的 logger 同时挂 Stream 与 File 两个
 *   handler，两边都读会是每行两份。
 *
 * `LogTail.locate` 只认 `<安装目录>/user/comfyui.log`；若用 `--user-directory` 或
 * `--base-directory` 改过位置，这里就找不到（能接受：找不到就是没日志，面板会说明）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { TerminalBuffer } from '../../../shared/comfy/output-buffer.js'
import type { ServiceStatus } from '../../../shared/comfy/supervisor.js'
import { sendJson } from '../../../shared/http/respond.js'

export type Route = (url: URL, res: ServerResponse, req: IncomingMessage) => void | Promise<void>

/**
 * 一次最多回多少行。
 *
 * 与缓冲容量取齐（2000）：取小了会在「一次要全量」时静默丢行，而 dropped 还是 0，
 * 用户只看到前半屏没了也查不出原因。
 */
const MAX_PAGE = 2000

export interface TerminalRouteDeps {
  /** 输出缓冲（runtime 持有：supervisor 写、这里读）。 */
  buffer: TerminalBuffer
  /** 当前托管状态，面板据此解释「为什么没有输出」。 */
  status: () => ServiceStatus
  /**
   * 拉起服务（面板上的「启动」按钮）。
   *
   * 终端只展示不启动的话，「打开终端看进度」必须先回对话生成一张图才会触发拉起 ——
   * 那正是用户想避免的被动等待。所以给一条独立的启动路径。
   */
  start: () => void
  /**
   * 停掉**本插件拉起的**进程（面板上的「关机」按钮）。
   *
   * 必须走终端自己的路由，不能借 `/service/stop`：那条路由挂在 `panel.workflow` 上，
   * 用户关掉工作流面板后点「关机」会直接 404。外部实例永不触碰（由 supervisor 保证）。
   */
  stop?: () => boolean
  /**
   * 复查「外部实例」是否还在。
   *
   * `external` 状态没有天然出口：别人把 ComfyUI 关掉后，插件无从得知，面板会永久
   * 停在「外部实例」而且启动按钮永远不出现。每次 GET 顺手复查一次就够。
   */
  recheckExternal?: () => Promise<boolean>
  /**
   * 队列里还有没有活（只在受管实例就绪时问）。
   *
   * 用它给「关机」加二次确认：正在出图时一键停进程会丢任务。外部实例不探测 ——
   * 那个状态本来就没有关机按钮，多一次请求只会拖慢面板。
   */
  busy?: (baseUrl: string) => Promise<boolean>
}

/**
 * 建终端面板的 HTTP 面。
 *
 * - `GET  /terminal?since=N`：拉增量（`since=0` 要当前全部）
 * - `POST /terminal`：清屏
 * - `POST /terminal?action=start`：拉起服务（不等就绪，进度由轮询的 status 反映）
 * - `POST /terminal?action=stop`：停掉本插件拉起的进程
 */
export function createTerminalRoutes(deps: TerminalRouteDeps): Record<string, Route> {
  return {
    '/terminal': async (url, res, req) => {
      // 这条路径在 router 里走 selfManaged（GET 读、POST 写），方法校验不经过通用层，
      // 所以这里自己挡：PUT/DELETE 之类不该落到"当 GET 处理"上。
      const method = req.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这个接口只接受 GET / POST。' })
        return
      }
      if (method === 'POST') {
        const action = url.searchParams.get('action')
        if (action === 'start') {
          deps.start()
          sendJson(res, 200, { ok: true, started: true, status: deps.status() })
          return
        }
        if (action === 'stop') {
          if (typeof deps.stop !== 'function') {
            sendJson(res, 501, { ok: false, error: 'not-supported', message: '这条部署没有开放停止服务。' })
            return
          }
          const stopped = deps.stop()
          sendJson(res, 200, { ok: true, stopped, status: deps.status() })
          return
        }
        deps.buffer.clear()
        sendJson(res, 200, { ok: true })
        return
      }

      let status = deps.status()
      // 外部实例没有天然出口：每次读状态顺手复查一次，关掉后能自己回到 unknown。
      if (status.state === 'external' && typeof deps.recheckExternal === 'function') {
        await deps.recheckExternal()
        status = deps.status()
      }
      // 只有受管实例才值得问队列：外部实例不显示关机，问了也白问。
      const busy = status.state === 'ready' && status.managed === true && typeof deps.busy === 'function'
        ? await deps.busy(status.baseUrl)
        : false

      const raw = url.searchParams.get('since')
      const parsed = raw === null ? 0 : Number(raw)
      const since = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
      const slice = deps.buffer.since(since)
      const truncated = slice.lines.length > MAX_PAGE
      sendJson(res, 200, {
        ok: true,
        lines: truncated ? slice.lines.slice(-MAX_PAGE) : slice.lines,
        cursor: slice.cursor,
        dropped: slice.dropped,
        truncated,
        // 缓冲实例代号：变了说明插件热重载过，前端的 cursor 与屏上内容都不再可信。
        epoch: slice.epoch,
        busy,
        status,
      })
    },
  }
}
