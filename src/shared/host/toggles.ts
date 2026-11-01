/**
 * 运行时可改的开关。
 *
 * 与 `Settings` 的分工：`Settings` 是启动时从 profile 配置 / 环境变量解析出来的
 * **快照**，改它要重启 DSH。这里是面板上能直接点的那些开关，落在插件自己的数据目录
 * （`~/.dsh-comfyui-workbench/settings.json`），改完**下一次提交就生效**。
 *
 * 优先级：这里的值 > profile / 环境变量 > 内置默认。所以面板上的开关是「覆盖」，
 * 配置文件仍然是「默认值」——用户不点开关时行为由配置决定，点了就以开关为准。
 *
 * **不缓存**：这个模块会被两条 entry 各内联一份（`/config` 在 `lib/index.js`、
 * `/run` 在 `lib/entries/workflow.js`），模块级缓存跨 bundle 不共享 ——
 * 面板写入只会失效自己那份，另一份要等 TTL 过期，于是「面板显示已开、下一次运行
 * 却没有进度」。文件只有几十字节，`/run` 本来就在读工作流文件，直接读盘最省心。
 */

import fs from 'node:fs'
import path from 'node:path'

import { ensureDir, pluginDataDir } from './paths.js'

/** 面板上可切换的开关。字段缺省表示「没覆盖，用配置的默认值」。 */
export interface Toggles {
  /** 用 `/ws` 读精确进度。 */
  progressStream?: boolean
}

/** 写开关时的补丁：`null` 表示删掉这一项（回退到配置默认值），`undefined` 表示不动。 */
export type TogglePatch = { progressStream?: boolean | null }

/** 文件名。 */
const FILE_NAME = 'settings.json'

/** 开关文件路径。 */
export function togglesPath(): string {
  return path.join(pluginDataDir(), FILE_NAME)
}

/**
 * 读文件里的**原始**键值对（不认识的键也留着）。
 *
 * 写回时要基于它：只改被 patch 的键，别的原样保留 —— 否则以后加了新开关，
 * 旧进程一次写入就会把它们静默抹掉。
 *
 * 文件不存在、坏了、不是对象，一律返回空对象：一个坏掉的 settings.json
 * 不该让 `/run` 提交失败。
 */
function readRaw(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(togglesPath(), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return { ...(parsed as Record<string, unknown>) }
  } catch {
    return {}
  }
}

/** 只认布尔值，别的（字符串、数字）一律当没写。 */
function normalize(raw: Record<string, unknown>): Toggles {
  return typeof raw.progressStream === 'boolean' ? { progressStream: raw.progressStream } : {}
}

/**
 * 读开关。
 *
 * 每次都读盘（见文件头「不缓存」的说明）。
 */
export function readToggles(): Toggles {
  return normalize(readRaw())
}

/**
 * 写开关。
 *
 * 先写临时文件再 rename：中途失败不会留半个 JSON（与 `RunRegistry.flush` 同做法）。
 * 写回的是**原始 bag**，所以文件里本模块不认识的键会原样保留。
 *
 * @param patch - `true` / `false` 写入；`null` 删掉这一项（回退到配置默认值）；
 *   `undefined` 不动。
 * @returns 写完之后读到的值。
 */
export function writeToggles(patch: TogglePatch): Toggles {
  const raw = readRaw()
  const next = patch.progressStream
  if (next === null) delete raw.progressStream
  else if (typeof next === 'boolean') raw.progressStream = next

  const target = togglesPath()
  ensureDir(path.dirname(target))
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, target)
  return normalize(raw)
}

/**
 * 空实现，只为兼容旧测试的调用点。
 *
 * 已经不缓存了，没有缓存要清。
 */
export function resetToggleCache(): void {
  // 无缓存可清
}

/**
 * 求「精确进度」的**有效值**：面板开关 > 配置 / 环境变量。
 *
 * 面板上点开关写的是 {@link Toggles}，配置里写的是默认值 —— 两者都要能生效，
 * 而用户点了开关之后不该再去改配置文件。
 *
 * @param settings - 启动时解析出来的配置快照。
 * @param toggles - 面板上存下来的覆盖值。
 */
export function effectiveProgressStream(
  settings: { progressStream: boolean },
  toggles: Toggles,
): boolean {
  return toggles.progressStream ?? settings.progressStream
}
