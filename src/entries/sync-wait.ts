/**
 * 组件：模型工具 · 同步等待。
 *
 * 独立 loader entry —— 宿主插件页里能看到它、能单独关掉。
 *
 * 它管的是「出图工具要不要接受 `wait` 参数」这一层能力：
 * - 开着（默认）：`comfyui_run` / `comfyui_rerun` / `comfyui_run_batch` 暴露 `wait`，
 *   默认值由配置 `runWait` 决定，「工作流管理」面板上也能切。
 * - 关掉：三个工具的 `wait` 参数消失，一律异步提交；面板上那个开关一并隐藏。
 *
 * 关掉它的场景很具体：如果你从来不用同步等待（批量刷图就是典型），
 * 少一个参数能让模型少一次犯错的余地 —— 它不会再去纠结「这次要不要等」。
 *
 * 本 entry 自身不注册任何东西：`wait` 的解析在工具里，工具的 entry 直接读
 * `disabledComponents`（各 entry 是独立 bundle，不能靠模块变量互相通知）。
 * 这条 entry 存在的意义是让这个能力在插件页可见、可开关。
 */

import type { HostContext } from '../shared/host/types.js'
import { resolveSettings } from '../shared/host/config.js'

export const name = 'dsh-comfyui-workbench:sync-wait'

/** 组件 id。 */
const COMPONENT = 'tool.sync-wait'

export function apply(_ctx: HostContext, config: unknown): void {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has(COMPONENT)) {
    console.warn(`[comfyui-workbench] 组件 ${COMPONENT} 已按配置关闭：出图工具不再接受 wait，一律异步。`)
    return
  }
  // 开着时无事可做 —— 工具自己读配置决定是否暴露 wait。
}
