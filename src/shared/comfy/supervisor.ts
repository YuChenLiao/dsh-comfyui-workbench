import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { homeDir } from '../host/paths.js'
import type { LoggerLike } from '../host/types.js'

/** 服务当前状态。 */
export type ServiceState = 'unknown' | 'external' | 'starting' | 'ready' | 'failed'

/** 托管配置。 */
export interface SupervisorOptions {
  /** 期望的服务地址，形如 `http://127.0.0.1:8188`。 */
  baseUrl: string
  /** 是否自动探测安装位置。 */
  autoDetect: boolean
  /** 未运行且已安装时是否拉起。 */
  autoStart: boolean
  /** 特殊情况下的完整启动命令（覆盖自动拼装）。 */
  startCommand?: string[]
  /** 就绪等待上限（ComfyUI 冷启比模型服务慢）。 */
  readyTimeoutMs: number
  /** 空闲多久后停止自己拉起的进程；0 表示不回收。 */
  idleShutdownMs: number
  /**
   * 子进程的输出回调（终端面板用）。
   *
   * 这里只接**插件自己拉起的**进程。外部实例的 stdout 在别的终端里，接不到 ——
   * 那种情况由终端面板改读 ComfyUI 写的 `user/comfyui.log`（见 shared/gallery 同级的
   * log-tail.ts）。两条路只走一条，因为这个回调一旦有数据就说明进程是我们起的。
   */
  onOutput?: ((stream: 'out' | 'err', text: string) => void) | undefined
  /** 安装探测器（测试可替换，默认走 detectInstallation）。 */
  detect?: (() => string | undefined) | undefined
  logger?: LoggerLike | undefined
}

/** 托管状态快照。 */
export interface ServiceStatus {
  state: ServiceState
  baseUrl: string
  /** 进程是否由本插件拉起（只有这种情况才会被停掉）。 */
  managed: boolean
  pid?: number
  installDir?: string
  /** 最近一次探测/拉起的说明。 */
  detail?: string
}

/** 一次轻量探测的结果。 */
async function probe(baseUrl: string, timeoutMs = 3_000): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** 从 baseUrl 里取端口。 */
function portOf(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return url.port !== '' ? url.port : '8188'
  } catch {
    return '8188'
  }
}

/** 判定一个目录像不像 ComfyUI 安装：有 main.py 且有 models 目录。 */
function looksLikeComfy(dir: string): boolean {
  try {
    if (!fs.statSync(path.join(dir, 'main.py')).isFile()) return false
    return fs.statSync(path.join(dir, 'models')).isDirectory()
  } catch {
    return false
  }
}

/**
 * 探测 ComfyUI 安装位置。
 *
 * 顺序：环境变量 → 上次成功路径 → 常见位置。判据是"有 main.py 且有 models 目录"，
 * 不是"目录叫 ComfyUI" —— 用户可能改过名，也可能装了多个。
 */
export function detectInstallation(extraRoots: readonly string[] = []): string | undefined {
  const candidates: string[] = []

  for (const key of ['COMFYUI_HOME', 'COMFYUI_PATH', 'COMFYUI_DIR']) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim() !== '') candidates.push(value.trim())
  }
  for (const root of extraRoots) candidates.push(root)

  const home = homeDir()
  if (home !== '') {
    candidates.push(path.join(home, 'ComfyUI'))
    candidates.push(path.join(home, 'comfyui'))
    candidates.push(path.join(home, '.dsh-comfyui-workbench', 'ComfyUI'))
  }
  const localAppData = process.env.LOCALAPPDATA
  if (typeof localAppData === 'string' && localAppData !== '') {
    candidates.push(path.join(localAppData, 'ComfyUI'))
    candidates.push(path.join(localAppData, 'Programs', 'ComfyUI'))
  }
  for (const drive of ['C:', 'D:', 'E:', 'F:']) {
    candidates.push(path.join(`${drive}${path.sep}`, 'ComfyUI'))
    candidates.push(path.join(`${drive}${path.sep}`, 'comfyui'))
    // 整合包：ComfyUI_windows_portable/ComfyUI
    candidates.push(path.join(`${drive}${path.sep}`, 'ComfyUI_windows_portable', 'ComfyUI'))
    // Desktop 版：Comfy-Desktop/ComfyUI-Installs/<实例名>/ComfyUI
    candidates.push(...desktopCandidates(`${drive}${path.sep}`))
  }

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = candidate.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (looksLikeComfy(candidate)) return candidate
  }
  return undefined
}

/**
 * Desktop 版的安装结构：`<drive>/Comfy-Desktop/ComfyUI-Installs/<实例>/ComfyUI`。
 *
 * 实例名由用户的安装决定（可能叫 comfyui、default……），所以列一层再逐个看。
 */
function desktopCandidates(root: string): string[] {
  const installs = path.join(root, 'Comfy-Desktop', 'ComfyUI-Installs')
  let names: string[]
  try {
    names = fs.readdirSync(installs)
  } catch {
    return []
  }
  return names.map(name => path.join(installs, name, 'ComfyUI'))
}

/** 选出可用的解释器：优先目录内的 venv / python_embeded，其次 Desktop 的 standalone-env。 */
function interpreterOf(dir: string): string {
  const parent = path.dirname(dir)
  const candidates = [
    path.join(dir, 'venv', 'Scripts', 'python.exe'),
    path.join(dir, 'venv', 'bin', 'python'),
    path.join(dir, 'python_embeded', 'python.exe'),
    path.join(dir, '.venv', 'Scripts', 'python.exe'),
    // Desktop 版：解释器在 ComfyUI 的上一级（ComfyUI-Installs/<实例>/standalone-env）
    path.join(parent, 'standalone-env', 'python.exe'),
    path.join(parent, 'standalone-env', 'bin', 'python'),
  ]
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // 换下一个
    }
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * ComfyUI 服务托管。
 *
 * 三条硬约束（`dsh-plugin-strata` 已踩过并验证）：
 *   - 只停**自己拉起的**进程，不碰外部实例；
 *   - 懒启动：第一次真正要用时才拉；
 *   - 拉起期间到达的请求排队等待，不立刻失败。
 */
export class ComfySupervisor {
  private readonly options: SupervisorOptions
  private state: ServiceState = 'unknown'
  private child: ChildProcess | null = null
  private installDir: string | undefined
  private detail = ''
  private lastUsedAt = 0
  private starting: Promise<boolean> | null = null
  private idleTimer: NodeJS.Timeout | null = null

  constructor(options: SupervisorOptions) {
    this.options = options
  }

  /** 当前状态快照。 */
  /**
   * 探测到的安装目录（日志文件在它下面的 `user/` 里）。
   *
   * **不能只靠 `start()` 里那次赋值**：外部实例（Desktop 自己起的）根本不会走到
   * `start()`，那时 `installDir` 永远是 undefined，日志就永远读不到 —— 而"想知道
   * 启动进度"恰恰多半发生在外部实例上。所以这里补一次惰性探测。
   */
  installDirOf(): string | undefined {
    if (this.installDir === undefined && !this.detectTried) {
      this.detectTried = true
      if (this.options.autoDetect) {
        try {
          this.installDir = (this.options.detect ?? detectInstallation)()
        } catch {
          // 探测失败就当没装，别把异常抛给调用方（它只是来读日志的）
        }
      }
    }
    return this.installDir
  }

  /** 是否已经尝试过安装探测（负缓存：没装也不能每 2 秒重扫一次盘）。 */
  private detectTried = false

  status(): ServiceStatus {
    return {
      state: this.state,
      baseUrl: this.options.baseUrl,
      managed: this.child !== null,
      ...(this.child?.pid === undefined ? {} : { pid: this.child.pid }),
      ...(this.installDir === undefined ? {} : { installDir: this.installDir }),
      ...(this.detail === '' ? {} : { detail: this.detail }),
    }
  }

  /**
   * 确保服务可用：外部在跑就直接用；没跑就拉起；拉不起来返回 false。
   *
   * @returns 是否可用。
   */
  async ensureReady(): Promise<boolean> {
    this.lastUsedAt = Date.now()

    if (await probe(this.options.baseUrl)) {
      if (this.state !== 'starting' && this.state !== 'ready') {
        this.state = this.child === null ? 'external' : 'ready'
      }
      return true
    }

    // 已经在拉起中：等同一个 promise，避免并发拉起两个进程。
    if (this.starting !== null) return await this.starting

    if (!this.options.autoDetect && this.options.startCommand === undefined) {
      this.state = 'failed'
      this.detail = `连不上 ${this.options.baseUrl}，且未开启自动探测。`
      return false
    }

    this.starting = this.start()
    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  /** 拉起进程并等待就绪。 */
  private async start(): Promise<boolean> {
    if (!this.options.autoStart && this.options.startCommand === undefined) {
      this.state = 'failed'
      this.detail = `连不上 ${this.options.baseUrl}，且 autoStart 已关闭。`
      return false
    }

    this.state = 'starting'
    const install = this.options.startCommand === undefined ? detectInstallation() : undefined
    if (this.options.startCommand === undefined && install === undefined) {
      this.state = 'failed'
      this.detail = '没有探测到 ComfyUI 安装（需要含 main.py 与 models 目录）。'
      return false
    }
    if (install !== undefined) this.installDir = install

    const argv = this.options.startCommand ?? [interpreterOf(install as string), 'main.py', '--port', portOf(this.options.baseUrl)]
    const cwd = install ?? undefined

    try {
      const child = spawn(argv[0] as string, argv.slice(1), {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true,
        env: {
          ...process.env,
          // 不指定的话 Windows 上 Python 按控制台代码页输出（GBK），
          // 面板里就是满屏乱码。统一成 UTF-8，解码侧才稳定。
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        },
      })
      this.pipeOutput(child)
      child.on('exit', () => {
        if (this.child === child) {
          this.child = null
          if (this.state === 'ready') this.state = 'unknown'
        }
      })
      this.child = child
      this.detail = `已拉起：${argv.join(' ')}`
      this.options.logger?.info?.(`[comfy] 拉起服务：${argv.join(' ')}（cwd=${cwd ?? '默认'}）`)
    } catch (error) {
      this.state = 'failed'
      this.detail = `拉起失败：${error instanceof Error ? error.message : String(error)}`
      return false
    }

    const deadline = Date.now() + this.options.readyTimeoutMs
    while (Date.now() < deadline) {
      if (await probe(this.options.baseUrl, 2_000)) {
        this.state = 'ready'
        this.armIdleTimer()
        return true
      }
      if (this.child === null) {
        this.state = 'failed'
        this.detail = '进程已退出（可能缺少依赖或端口被占用）。'
        return false
      }
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }

    this.state = 'failed'
    this.detail = `等待 ${Math.round(this.options.readyTimeoutMs / 1000)} 秒仍未就绪。`
    return false
  }

  /**
   * 把子进程的 stdout/stderr 接到 options.onOutput。
   *
   * 用 TextDecoder 而不是 `setEncoding('utf8')`：进程退出时可能把多字节字符截断在
   * 半个字符上，`decode(..., { stream: true })` 能跨块拼接，最后再 flush 一次。
   */
  private pipeOutput(child: ChildProcess): void {
    const sink = this.options.onOutput
    const attach = (stream: 'out' | 'err', readable: NodeJS.ReadableStream | null): void => {
      if (readable === null) return
      const decoder = new TextDecoder('utf-8', { fatal: false })
      readable.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
        if (text !== '') sink?.(stream, text)
      })
      readable.on('end', () => {
        const rest = decoder.decode()
        if (rest !== '') sink?.(stream, rest)
      })
      // 流错误不该影响服务本身
      readable.on('error', () => { /* 忽略 */ })
    }
    attach('out', child.stdout)
    attach('err', child.stderr)
  }

  /** 启动空闲回收定时器（只针对自己拉起的进程）。 */
  private armIdleTimer(): void {
    if (this.options.idleShutdownMs <= 0 || this.idleTimer !== null) return
    this.idleTimer = setInterval(() => {
      if (this.child === null) {
        this.clearIdleTimer()
        return
      }
      if (Date.now() - this.lastUsedAt < this.options.idleShutdownMs) return
      this.stop()
    }, Math.min(60_000, Math.max(5_000, Math.floor(this.options.idleShutdownMs / 4))))
    // 不阻止进程退出
    this.idleTimer.unref?.()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  /** 停掉自己拉起的进程。外部实例永不触碰。 */
  stop(): boolean {
    this.clearIdleTimer()
    const child = this.child
    if (child === null) {
      this.detail = '没有本插件拉起的进程，未停止任何东西。'
      return false
    }
    try {
      child.kill()
    } catch {
      // 已经退出
    }
    this.child = null
    this.state = 'unknown'
    this.detail = '已停止本插件拉起的进程。'
    return true
  }

  /** 释放定时器（插件卸载时调用）。 */
  dispose(): void {
    this.clearIdleTimer()
  }
}
