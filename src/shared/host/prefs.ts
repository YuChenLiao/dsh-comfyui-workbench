/**
 * 本机轻量偏好（localStorage）。
 *
 * 为什么不用服务端 settings：这类开关是**本机隐私边界** —— 隐藏 NSFW 要的是"这台机器上不显示"，
 * 跨设备同步反而是坏事（在客厅那台机器上悄悄变回显示）。
 *
 * localStorage 在隐私模式、被策略禁用或配额满时会抛，所以读写都必须能失败而不影响功能：
 * 读失败用默认值，写失败静默。
 *
 * 放在 `shared/host` 而不是 `client/`：这样能被 `node --test` 直接单测（stub 一个 window 即可），
 * 不必依赖客户端 bundle。模块加载时不碰 `window`，只在函数调用时读，服务端 import 也安全。
 */
const PREFIX = 'dsh-comfyui-workbench:'

/** 取出 localStorage（拿不到就返回 undefined，调用方按"没有"处理）。 */
function storage(): Storage | undefined {
  try {
    const view = (globalThis as { window?: { localStorage?: Storage } }).window
    return view?.localStorage
  } catch {
    return undefined
  }
}

/**
 * 读一个布尔偏好。
 *
 * @param key - 键名（不带前缀）。
 * @param fallback - 没存过或读不出来时的值。
 */
export function readPref(key: string, fallback: boolean): boolean {
  try {
    const raw = storage()?.getItem(PREFIX + key)
    if (raw === '1') return true
    if (raw === '0') return false
    return fallback
  } catch {
    return fallback
  }
}

/**
 * 写一个布尔偏好（存不下就算了，不打断操作）。
 *
 * @param key - 键名（不带前缀）。
 * @param value - 值。
 */
export function writePref(key: string, value: boolean): void {
  try {
    storage()?.setItem(PREFIX + key, value ? '1' : '0')
  } catch {
    // 存不了就只是下次不记住，功能本身不受影响
  }
}
