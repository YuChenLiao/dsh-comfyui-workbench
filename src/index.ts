/**
 * dsh-comfyui-workbench —— 宿主侧入口。
 *
 * 装配职责只有三件：解析配置、注册 HTTP 路由、注册工具。具体逻辑分层在：
 *   scan/      读磁盘与图片内嵌元数据（只依赖 node:*）
 *   host/      宿主最小面、logger、配置、路径
 *   assets/    根目录授权、扫描缓存、缩略图、去重、删除、ZIP
 *   workflow/  模板、IO 面推断、变量应用
 *   comfy/     ComfyUI 传输与错误分类
 *   run/       预检 → 提交 → 轮询 → 取产物 → sidecar
 *   tools/     四个模型工具
 *   http/      解析请求 → 调 service → 写响应
 */
import fs from 'node:fs'
import path from 'node:path'

import { ComfyClient, ComfySupervisor } from './comfy/index.js'
import { isAuthorized } from './assets/authorize.js'
import { rootsOf } from './assets/roots.js'
import { resolveSettings } from './host/config.js'
import { resolveLogger } from './host/logger.js'
import { ensureDir, pluginDataDir, workflowsDir } from './host/paths.js'
import { resolveOutputDir, workspaceDirOf } from './host/workspace.js'

// 供测试与诊断使用：产物目录的解析规则要能被单独验证。
export { resolveOutputDir, workspaceDirOf } from './host/workspace.js'
// 组件注册器要能被单独验证：某个工具构建失败不该拖累其他。
export { registerTools, TOOL_GROUPS } from './tools/index.js'
import type { HostContext, WebServerLike } from './host/types.js'
import { createHandler, PREFIX } from './http/router.js'
import { AssetIndex } from './store/index.js'
import { stopAllWatchers } from './run/index.js'
import { registerTools, TOOL_GROUPS } from './tools/index.js'
import type { ToolRegistrationReport } from './tools/index.js'
import type { ToolSpec } from './tools/index.js'

/** 插件名（同时是 loader entry 的默认 id）。 */
export const name = 'dsh-comfyui-workbench'

/** 需要的宿主服务：HTTP 路由载体。tools 走可选获取，缺它不该让整个插件停摆。 */
export const inject = ['webServer']

/** 宿主 tools 服务的最小面。 */
interface ToolsLike {
  register: (spec: ToolSpec) => (() => void) | void
}

/**
 * 读当前 package.json 的版本号。
 *
 * 每次调用都重新读：宿主重载插件时会复用 ESM 模块缓存，把版本写死在模块顶层
 * 会让健康检查一直报旧版本。
 */
function readVersion(): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 版本号，随 package.json 走。 */
export const VERSION = readVersion()

/**
 * 插件入口。
 *
 * @param ctx - 宿主上下文。
 * @param config - loader 传入的配置。
 */
export function apply(ctx: HostContext, config: unknown): void {
  const settings = resolveSettings(config)
  const logger = resolveLogger(ctx, name)
  const warn = logger?.warn ?? console.warn
  const info = logger?.info ?? console.info

  /** 工作流目录：配置可覆盖，默认 $HOME/.dsh-comfyui-workbench/workflows。 */
  const flowDir = settings.workflowsDir ?? workflowsDir()

  // 上传目录与产物目录先建出来：rootsOf 只收已存在的目录，晚建会让刚传的图预览 403。
  const uploadsDir = settings.uploadsDir ?? path.join(pluginDataDir(), 'uploads')
  ensureDir(uploadsDir)
  // 产物默认落到插件数据目录，而不是 process.cwd() —— dsh 进程的 cwd 是 profile 目录，
  // 往那里写图等于污染宿主自己的安装树。
  // 产物默认落到当前工作区（`<workspace>/comfyui-output`），而不是插件私有目录 ——
  // 图就该出现在用户正在做的项目里，不该逼用户再去别处找、或者让模型复制一份。
  const workspaceGuess = workspaceDirOf(ctx)
  const resolved = resolveOutputDir(settings.outputDir, workspaceGuess, pluginDataDir())
  const outputDir = resolved.dir
  const outputSource = resolved.source
  // 目录不存在就建出来：探测到工作区后落到 <工作区>/comfyui-output。
  ensureDir(outputDir)

  // 服务托管：外部在跑就只用不托管；没跑且装了才拉起；只停自己拉起的那个。
  const supervisor = new ComfySupervisor({
    baseUrl: settings.baseUrl,
    autoDetect: settings.autoDetect,
    autoStart: settings.autoStart,
    ...(settings.startCommand.length === 0 ? {} : { startCommand: settings.startCommand }),
    readyTimeoutMs: settings.readyTimeoutMs,
    idleShutdownMs: settings.idleShutdownMs,
    logger,
  })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      supervisor.dispose()
      stopAllWatchers()
    }, `${name}: supervisor`)
  }

  // 构造客户端不产生连接，HTTP 路由与工具共用同一个实例（object_info 缓存也共用）。
  const client = new ComfyClient({
    baseUrl: settings.baseUrl,
    headers: settings.headers,
    requestTimeoutMs: settings.timeoutMs,
    ensure: () => supervisor.ensureReady(),
  })

  const track = (dispose: (() => void) | void): void => {
    if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
      // 交给宿主在卸载时调用
      ctx.effect(() => dispose, `${name}: disposer`)
    }
  }

  const assetIndex = settings.indexFile === null ? new AssetIndex() : new AssetIndex(settings.indexFile)

  /**
   * 输出目录必须落在授权根内。
   *
   * 默认输出目录（配置的 outputDir 或 workspace 根）本来就在 roots 里；
   * 这条只挡"显式指定了一个根外路径"的情况 —— 那种写入等于给任意目录开后门。
   */
  const rootsSettings = { ...settings, resolvedOutputDir: outputDir }
  const assertWritable = (dir: string): void => {
    const roots = rootsOf(ctx, rootsSettings)
    if (roots.length === 0) return // 还没有任何根（未进入 workspace）：交给 runner 的目录创建报错
    if (!isAuthorized(dir, roots)) {
      throw new Error(`输出目录不在授权范围内：${dir}。请在配置的 assetRoots 里加上它，或改用 workspace 内的目录。`)
    }
  }

  // ── 组件开关 ──
  // 四个组件互相独立：用户面板（工作流 / 相册）与模型工具（生图 / 工作流编辑）。
  // 关掉一个只影响它自己 —— 出了问题时用户可以单独停用，而不是整插件卸载。
  const disabled = new Set(settings.disabledComponents)
  const isOn = (id: string): boolean => !disabled.has(id)
  const componentState: Record<'panel.workflow' | 'panel.gallery' | 'tool.generate' | 'tool.workflow-edit', boolean> = {
    'panel.workflow': isOn('panel.workflow'),
    'panel.gallery': isOn('panel.gallery'),
    'tool.generate': isOn('tool.generate'),
    'tool.workflow-edit': isOn('tool.workflow-edit'),
  }
  for (const [id, on] of Object.entries(componentState)) {
    if (!on) warn(`[${name}] 组件 ${id} 已按配置关闭。`)
  }

  // ── HTTP 路由 ──
  const server = ctx.get?.('webServer') as WebServerLike | undefined
  if (server === undefined || typeof server.register !== 'function') {
    warn(`[${name}] 拿不到 webServer 服务，资产库 API 未注册。`)
  } else {
    const handler = createHandler(ctx, settings, assetIndex, flowDir, client, supervisor, assertWritable, uploadsDir, outputDir, outputSource, {
      gallery: componentState['panel.gallery'],
      workflow: componentState['panel.workflow'],
    }, () => ({ components: componentState, tools: report }))
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => server.register({ kind: 'prefix', path: PREFIX, handler }), `${name}: http routes`)
    } else {
      server.register({ kind: 'prefix', path: PREFIX, handler })
    }
    info(`[${name}] v${VERSION} 资产库 API 就绪：${PREFIX}（最大深度 ${settings.maxDepth}）`)
  }

  // ── 工具（可选） ──
  const tools = ctx.get?.('tools') as ToolsLike | undefined
  if (tools === undefined || typeof tools.register !== 'function') {
    warn(`[${name}] 拿不到 tools 服务，工作流工具未注册（资产库仍可用）。`)
    return
  }

  // 逐组注册：某一组的构建或注册抛错只影响它自己，其余照常上线。
  const report: ToolRegistrationReport = registerTools(TOOL_GROUPS, {
    client,
    workflowsDir: flowDir,
    outputDir,
    timeoutMs: settings.timeoutMs,
    pollIntervalMs: settings.pollIntervalMs,
    overrides: new Map(),
    index: assetIndex,
    assertWritable,
    logger,
  }, {
    enabled: TOOL_GROUPS.filter((group: { component: string }) => componentState[group.component as keyof typeof componentState]).map((group: { name: string }) => group.name),
    register: (spec: ToolSpec) => track(tools.register(spec)),
    warn,
  })

  for (const failure of report.failed) {
    warn(`[${name}] 工具 ${failure.name} 未注册：${failure.message}`)
  }
  info(`[${name}] 工作流工具已注册 ${report.registered.length} 个${report.skipped.length === 0 ? '' : `，按配置跳过 ${report.skipped.length} 个`}（数据目录 ${pluginDataDir()}）`)
}
