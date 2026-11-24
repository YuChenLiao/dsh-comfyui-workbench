/**
 * 组件：角色参考库（面板 + 模型工具）。
 *
 * 20 个 AI 娘角色设定板（三视图 / 表情 / 服装 / 道具 / 整板），来自
 * lmy414/ai-chan-sheets。与姿势库、服装库同一套接入方式：**元数据随包、图经服务端
 * 代理按需取**，共用同一个取图实现 `createImageCache`，只是换了 origin、路径白名单、
 * 缓存目录与三个新参数（递归缓存 / 更大的字节上限 / 落盘改名）。
 *
 * ## 为什么落盘要改名
 *
 * 每个角色的三视图都叫 `横版完整设定图_01_三视图_查看用.jpg` —— basename 全库相同。
 * `materialize` 默认按 basename 落盘，20 个角色会互相覆盖，工作流里那条旧路径会
 * 悄悄指向另一张图。所以这里显式传 `<id>_<slot>.<ext>`。
 *
 * ## 数据
 *
 * `data/characters/catalog.json` 只有 id、角色名、副标题、品牌、五个槽位的相对路径。
 * 一张图都不在仓库里；许可是 CC BY-NC-SA 4.0（非商业），见 `data/characters/NOTICE.md`。
 */
import fs from 'node:fs'
import path from 'node:path'

import { createCharacterRoutes } from '../components/panel-characters/server/routes.js'
import { bundledCharacterCatalogPath, createCharactersIndex } from '../components/panel-characters/server/catalog.js'
import { characterTool } from '../components/panel-characters/server/tools.js'
import { createImageCache } from '../components/panel-poses/server/images.js'
import type { CharactersIndex } from '../components/panel-characters/server/catalog.js'
import type { PoseImages } from '../components/panel-poses/server/images.js'
import { mountHostRoutes, onHostDispose, registerHostTools } from '../shared/host/adapter.js'
import { resolveSettings } from '../shared/host/config.js'
import { pluginDataDir } from '../shared/host/paths.js'
import type { HostContext } from '../shared/host/types.js'
import { acquire, ensureHttp, mountRoutes, release } from '../runtime.js'

export const name = 'dsh-comfyui-workbench:characters'

export const inject = ['webServer', 'workspaceRegistry', 'tools']

/** 组件 id，可单独关（`disabledComponents: ['panel.characters']`）。 */
export const COMPONENT = 'panel.characters'

/** 原站：raw.githubusercontent.com 的固定 commit 前缀（catalog 里也记了一份）。 */
export const CHARACTER_ORIGIN = 'https://raw.githubusercontent.com'

/**
 * 角色图的路径白名单。**与 `scripts/import-characters.mjs` 那条必须逐字一致。**
 *
 * 与另两个库的差别：允许中文、`·`、括号与空格，且只放行 `设定图/` 与 `docs/` 两棵子树。
 * 负向断言 `(?!.*\.\./)` 不能省：字符类里含 `.` 与 `/`，没有它 `设定图/../../x.png`
 * 也能通过 —— 落盘时 `path.join(cacheDir, rel)` 会写到缓存目录之外。
 * 尾部的 `i` 与导入脚本一致：上游一旦出现 `.JPG`，不带 `i` 会「导入成功但运行时永远 502」。
 */
export const CHARACTER_PATH = /^(设定图|docs)\/(?!.*\.\.\/)[\p{Script=Han}A-Za-z0-9_./·（）() -]+\.(png|jpe?g|webp)$/iu

/** 索引与取图器的模块级单例（apply 重跑不该把冷却与缓存清零）。 */
interface Store { index: CharactersIndex; images: PoseImages; uploadsDir: () => string }
let singleton: { key: string; store: Store } | null = null

/**
 * 角色图的单张上限。
 *
 * 显式给而不是吃 `images.ts` 的默认值：那个默认值是三个素材库共用的，改它不该
 * 悄悄改变角色库能取多大的图。当前最大的一张是 2.65 MB 的整板切片，8 MB 留足余量。
 * `tests/characters.test.mjs` 会核对 catalog 里最大的 bytes 仍在这条线以内。
 */
export const CHARACTER_MAX_BYTES = 8_000_000

/**
 * 上游 origin：**固定到某个 commit**。
 *
 * 上游改名/删目录时，钉住 commit 的路径仍然可达。只认 40 位十六进制 —— 塞 `#` / `?`
 * 改不了主机（authority 在域名处就闭合了），但能把全部取图悄悄指向另一个 ref。
 * 之所以导出，是因为在线体检脚本要对拍同一个拼法；两处各拼一份就是两份真相。
 */
export function characterOrigin(commit: string): string {
  if (/^[0-9a-f]{40}$/.test(commit) === false) {
    throw new Error(`角色库 catalog 的 commit 不是 40 位十六进制：${JSON.stringify(commit)}（重跑 npm run characters:import）`)
  }
  return `${CHARACTER_ORIGIN}/lmy414/ai-chan-sheets/${commit}`
}

/**
 * 角色库的取图器参数。
 *
 * 抽成函数是为了让测试能验**真配置**：测试若自己写一份 `createImageCache({...})`，
 * 就等于给闸门配一把假钥匙 —— entries 漏传 `pathPattern` 或把 `cacheSubdirs`
 * 写成 `['img']` 时，测试照样全绿（这两种改法都实测过，全绿）。
 */
export function characterImageOptions(cacheDir: string, origin: string): Parameters<typeof createImageCache>[0] {
  return {
    cacheDir,
    origin,
    pathPattern: CHARACTER_PATH,
    // 落盘路径是 `cacheDir + 白名单放行的相对路径`，也就是 `cache/characters/设定图/…`
    // 与 `cache/characters/docs/…` —— 这两棵子树才是真实的一级目录。
    // 写成 ['img'] 的话 walkCacheFiles 恒返回空：缓存上限不生效、/characters/cache 恒报 0。
    cacheSubdirs: ['设定图', 'docs'],
    // 角色图落成 `设定图/<角色目录>/<槽位>.jpg` 多级，必须递归扫。
    recursiveCache: true,
    maxBytes: CHARACTER_MAX_BYTES,
  }
}

function storeOf(dataDir: string, uploadsDir: () => string): Store {
  const index = createCharactersIndex(dataDir)
  const origin = characterOrigin(index.stats().commit)
  const key = `${dataDir}|${origin}`
  if (singleton !== null && singleton.key === key) return singleton.store
  const images = createImageCache(characterImageOptions(path.join(dataDir, 'cache', 'characters'), origin))
  const store = { index, images, uploadsDir }
  singleton = { key, store }
  return store
}

/** 把失败原因落盘：宿主会吞掉 apply 的异常。 */
function recordFailure(error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  try {
    const dir = pluginDataDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'last-error.log'), `[${new Date().toISOString()}] characters entry\n${message}\n`, 'utf8')
  } catch {
    // 连日志都写不了就只能放弃
  }
}

export function apply(ctx: HostContext, config: unknown): void {
  try {
    applyInner(ctx, config)
  } catch (error) {
    recordFailure(error)
    throw error
  }
}

function applyInner(ctx: HostContext, config: unknown): void {
  const settings = resolveSettings(config, process.env)
  if (new Set(settings.disabledComponents).has(COMPONENT)) {
    console.warn(`[comfyui-workbench] 组件 ${COMPONENT} 已按配置关闭。`)
    return
  }

  const dataDir = pluginDataDir()
  const uploadsDir = (): string => settings.uploadsDir ?? path.join(dataDir, 'uploads')

  // catalog 缺失时不要抛：面板该给出「数据没导入」的提示，而不是让整个插件起不来。
  const hasCatalog = fs.existsSync(path.join(dataDir, 'characters', 'catalog.json'))
    || fs.existsSync(bundledCharacterCatalogPath(import.meta.url))
  if (hasCatalog === false) {
    console.warn('[comfyui-workbench] 角色库没有 catalog.json，组件跳过（跑 npm run characters:import）。')
    return
  }

  const { index, images } = storeOf(dataDir, uploadsDir)
  const routes = createCharacterRoutes({ index, images, uploadsDir })

  const rt = acquire(ctx, config)
  onHostDispose(ctx, 'characters: runtime', () => release(ctx))

  // 素材面的第三半（姿势库与衣装库各占一半，工具侧惰性取）：
  // 让 `comfyui_compose` 能直接吃角色设定板，不必让模型自己落盘再传路径。
  rt.materials = {
    ...rt.materials,
    character: id => {
      const item = index.get(id)
      return item === undefined ? undefined : { id: item.id, name: item.name }
    },
    fetchCharacter: async (id, view) => {
      const found = index.get(id)
      if (found === undefined) throw new Error(`没有这个角色：${id}`)
      const slot = found.slots[view]
      if (slot === undefined) {
        throw new Error(`${found.name} 没有 ${view}，可用：${Object.keys(found.slots).join(' / ')}。`)
      }
      // 落盘名 `<id>_<view>.<ext>`：所有角色的切片 basename 相同
      // （都叫 `横版完整设定图_01_三视图_查看用.jpg`），不指定就互相覆盖。
      const ext = /\.(png|jpe?g|webp)$/i.exec(slot.path)?.[1]?.toLowerCase() ?? 'jpg'
      const { file } = await images.materialize(slot.path, uploadsDir(), `${id}_${view}.${ext}`)
      return file
    },
  }

  ensureHttp(ctx, rt)
  mountHostRoutes(ctx, 'characters: routes', () => mountRoutes(ctx, COMPONENT, { exact: routes.exact }))

  registerHostTools(ctx, [characterTool({ index, images, uploadsDir })], {
    label: 'characters',
    missingMessage: '[comfyui-workbench] 拿不到 tools 服务，角色工具未注册。',
  })

  const stats = index.stats()
  rt.info(`[comfyui-workbench] 角色库已上线：${stats.characterCount} 个角色 / ${Object.keys(stats.brands).length} 个品牌`)
}
