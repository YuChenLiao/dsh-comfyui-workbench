/**
 * 从 ComfyUI 的 WebSocket 读精确进度。
 *
 * 轮询只能答"在跑吗、排队第几"，答不了"这张图画到 37% 了"。ComfyUI 在 `/ws`
 * 上推 `progress` 事件（`{value, max}`），接上就能给百分比。
 *
 * **设计成"连不上就静默什么都不做"**：WebSocket 是本插件唯一的长连接，
 * 也是最容易在别人的网络环境里翻车的东西（代理、反代、鉴权层）。所以：
 * - 连不上 / 报错 / 超时 → 立刻返回一个空的取消函数，不抛、不记 error
 * - 调用方（`sweepRun`）本来就在轮询，拿不到进度只是少了个百分比，
 *   不会影响"能不能出图"
 *
 * 真机事实（对照本机 ComfyUI 源码 + 实测核实）：
 * - `progress` 带 sid 发出（`main.py:475`），`server.client_id` 在**开始执行**时由
 *   `extra_data["client_id"]` 赋值（`execution.py:740`）—— 也就是本任务的提交方。
 *   所以订阅**必须复用提交时的 `clientId`**，随机 id 永远收不到（实测 20 步 0 事件）。
 * - `server.py:341-345` 同 sid 再连会 `self.sockets.pop(sid, None)`：旧连接不 close、
 *   只是不再收消息。因此同一个 `client_id` 只能有一条活着的订阅，并发两条运行时
 *   先建的那条会静默没有百分比。
 * - 默认关（`Settings.progressStream`，或 `COMFYUI_PROGRESS_WS=1`）；目前只有
 *   `/run` 与 `/rerun` 两条面板路径接线，工具侧没有（`ToolDeps` 里没有 settings）。
 * - Node 20 没有全局 `WebSocket`（engines 写的是 >=20），那时会静默不生效。
 */

/** 进度回调。 */
export interface ProgressTick {
  /** 已完成的值。 */
  value: number
  /** 总值；0 表示未知。 */
  max: number
}

/** ComfyUI 在 `/ws` 上推的事件形状（只取用得到的字段）。 */
interface WsMessage {
  type?: unknown
  data?: { value?: unknown; max?: unknown; prompt_id?: unknown; node?: unknown }
}

/**
 * 订阅一次运行的进度。
 *
 * @param baseUrl - ComfyUI 根地址（`http://host:port`）。
 * @param promptId - 要盯的运行 id。
 * @param onTick - 收到进度时调用。
 * @param options - 超时与地址改写（`ws://` 由这里生成）。
 * @returns 取消函数（总是可调用，连不上时是空操作）。
 */
export function watchProgress(
  baseUrl: string,
  promptId: string,
  onTick: (tick: ProgressTick) => void,
  options: {
    connectTimeoutMs?: number
    /**
     * 必须与**提交任务时**用的 `client_id` 一致。
     *
     * ComfyUI 发 `progress` 时带的是 `server.client_id`（`main.py:475` 的
     * `send_sync("progress", progress, client_id)`），也就是最后一个提交任务的
     * 那个客户端。自己另造一个随机 id 连上去，握手会成功、`status` 能收到，
     * 但**永远收不到本任务的 progress** —— 真机实测过：20 步跑完，相关事件 0 条。
     *
     * 不传时才退回一个随机 id（只用于测试或独立调试）。
     */
    clientId?: string
    /**
     * 只用来**告知**降级，不参与判断。
     *
     * 没有它的话，"以为开了、其实一直静默降级"没人能发现 ——
     * 这是静默降级类功能最容易积的债。
     */
    logger?: { info?: (message: string) => void; warn?: (message: string) => void } | undefined
  } = {},
): () => void {
  // 全局 WebSocket 是 Node 22+ 才有的；老运行时直接当没有
  const Ctor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
  if (Ctor === undefined) {
    // Node 20 没有全局 WebSocket：一声不响地降级，这里至少留个痕
    safeInfo(options.logger, `[progress] 当前运行时没有全局 WebSocket，进度订阅不生效`)
    return () => {}
  }

  const clientId = options.clientId ?? `comfyui-workbench-${Math.random().toString(36).slice(2)}`
  const url = `${baseUrl.replace(/^http/i, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`
  let socket: WebSocket | undefined
  let closed = false

  try {
    socket = new Ctor(url)
  } catch (error) {
    // 地址不合法之类：当作没有进度，不打扰调用方
    safeInfo(options.logger, `[progress] 建不了连接：${error instanceof Error ? error.message : String(error)}`)
    return () => {}
  }

  const timer = setTimeout(() => {
    // 连不上就别耗着：调用方的轮询本来就能兜底
    if (!closed) {
      closed = true
      try {
        socket?.close()
      } catch {
        // 关不掉也算了
      }
    }
  }, options.connectTimeoutMs ?? 3_000)
  timer.unref?.()

  socket.addEventListener('message', event => {
    if (closed) return
    let parsed: WsMessage
    try {
      parsed = JSON.parse(typeof event.data === 'string' ? event.data : '') as WsMessage
    } catch {
      return
    }
    if (parsed.type !== 'progress') return
    // 只认这一条运行的。缺失时**也要**忽略 —— 一条没有 id 的进度
    // 不该串到当前 run 上（多个任务共用同一个 /ws）。
    const id = parsed.data?.prompt_id
    if (id !== promptId) return
    const value = typeof parsed.data?.value === 'number' ? parsed.data.value : undefined
    const max = typeof parsed.data?.max === 'number' ? parsed.data.max : undefined
    if (value === undefined) return
    try {
      onTick({ value, max: max ?? 0 })
    } catch {
      // 回调自己抛错不该断掉订阅
    }
  })

  // 连接建立前就把超时留着；建立后清掉（后面靠 close 收尾）
  socket.addEventListener('open', () => {
    clearTimeout(timer)
  })

  // 出错一律静默：拿不到进度不是错误。但要把 socket 关掉，
  // 别指望底层自行回收（长时间跑的工作流会攒下一条断连）。
  socket.addEventListener('error', () => {
    safeInfo(options.logger, `[progress] ${url} 连接失败，本次运行没有百分比`)
    closed = true
    clearTimeout(timer)
    try {
      socket?.close()
    } catch {
      // 已经断了
    }
  })

  return () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    try {
      socket?.close()
    } catch {
      // 已经断了
    }
  }
}

/** 日志兜底：logger 自己抛错不该影响订阅。 */
function safeInfo(
  logger: { info?: (message: string) => void } | undefined,
  message: string,
): void {
  try {
    logger?.info?.(message)
  } catch {
    // 记不下就算了
  }
}
