/**
 * 包根入口（name 必须是不带子路径的包名）。
 *
 * 为什么需要它：宿主只给**包根说明符**装配浏览器端
 * （`dsh-client-modules` 的 `exactPackageSpecifier` 明确排除包子路径）。
 * 五个组件是 `dsh-comfyui-workbench/<name>` 这样的子路径 entry，能注册服务端，
 * 但挂不上 client —— 少了这条包根 entry，侧栏图标与 better-sidebar 页签根本不会被加载。
 *
 * 所以这条 entry 只做两件事：让包根的 `exports["./client"]` 被装配、
 * 把共享运行时初始化好（四条组件 entry 直接复用）。
 */
import { apply as applyEdit } from './entries/edit.js'
import { apply as applyGallery } from './entries/gallery.js'
import { apply as applyGenerate } from './entries/generate.js'
import { apply as applyWorkflow } from './entries/workflow.js'
import type { HostContext } from './shared/host/types.js'
import { acquire, ensureHttp, release } from './runtime.js'

export const name = 'dsh-comfyui-workbench'

/**
 * 注入清单。
 *
 * - `webServer`：HTTP 前缀由这里兜底注册。若 core 拿不到，前缀会落到第一个拿到它的
 *   组件 entry 身上 —— 那样单独关掉那个组件，其余面板就跟着失效。
 * - `workspaceRegistry`：产物目录要落在用户当前的工作区。注入的作用是**时序**：
 *   服务未就绪时 fiber 处于 INACTIVE、`apply` 不执行，探测会等它 ACTIVE 之后再跑
 *   （`ctx.reflect.get` 本身不要求注入）。另一个坑是服务名 —— 它叫 `workspaceRegistry`，
 *   `workspace` 只是它在 storages 里的域名（`workspace.json` 的 `unit.name`），
 *   两者混淆过一次，导致探测静默失效。
 */
export const inject = ['webServer', 'workspaceRegistry']

export function apply(ctx: HostContext, config: unknown): void {
  const rt = acquire(ctx, config)
  // 必须配对：只 acquire 不 release 会让 refs 永不到 0，旧 Runtime 带着失效的 ctx 存活，
  // 重载时注册 effect 会抛 INACTIVE_EFFECT（相册整块消失，要等第二次重载才自愈）。
  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'core: runtime')

  // 前缀也由 core 兜一次：核心 entry 不会被单独关掉，重载后它能把 API 重新挂上。
  ensureHttp(ctx, rt)
}

/**
 * 一次装载全部五个组件（测试与"只想挂一条 entry"的场景用）。
 *
 * 生产环境不用它：`cordis.patch.yml` 里是六条 entry（一条包根 + 四条组件），
 * 每条各自注册，宿主才能单独开关。
 */
export function applyAll(ctx: HostContext, config: unknown): void {
  applyGallery(ctx, config)
  applyWorkflow(ctx, config)
  applyGenerate(ctx, config)
  applyEdit(ctx, config)
}

// 测试与诊断用：这些能力要能被单独验证。
export { probeWorkspace, resolveOutputDir, workspaceDirOf } from './shared/host/workspace.js'
export { isAuthorized } from './shared/authz/authorize.js'
export { foldPathCase } from './shared/host/paths.js'
export {
  createTagCache,
  danbooruLookupTool,
  danbooruSyncTool,
  pickNames,
  pruneSharedAliases,
  readStore,
  runSync,
  currentMirrors,
  fetchJson,
  MIRRORS,
  searchOnline,
  searchOnlineDetailed,
  searchTags,
  storePath,
  syncKind,
  useMirrors,
  useTimeout,
  worthKeeping,
  writeStore,
  DEFAULT_SYNC,
  DANBOORU_COMPONENT,
} from './components/tool-danbooru/index.js'
export { registerTools, TOOL_GROUPS } from './components/tool-generate/index.js'
export { acquire, release, componentStateOf, mergedRoutes } from './runtime.js'
