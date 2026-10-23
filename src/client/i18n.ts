import { DICT } from './i18n-data.js'

/** 取文案：先按当前语言，再回退中文，最后回退 key 本身。 */
export type Translate = (key: string) => string

/**
 * 按宿主当前语言生成翻译函数。
 *
 * 语言快照拿不到时一律用中文 —— 宁可显示中文，也不要显示未翻译的英文标识符。
 *
 * @param active - 宿主的 active locale（如 'zh-CN' / 'en'）。
 */
export function makeTranslate(active: string): Translate {
  const table: Record<string, string> = /^en/i.test(active) ? (DICT.en as Record<string, string>) : (DICT.zh as Record<string, string>)
  const fallback = DICT.zh as Record<string, string>
  return (key: string) => table[key] ?? fallback[key] ?? key
}

/**
 * 从宿主的 locale 服务里读当前语言。
 *
 * @param locale - `ctx.get('locale')` 的返回值（形状不保证，全部按可选处理）。
 */
export function activeLocaleOf(locale: unknown): string {
  try {
    const bag = locale as { getSnapshot?: () => unknown } | null
    const snapshot = typeof bag?.getSnapshot === 'function' ? bag.getSnapshot() : null
    const active = snapshot !== null && typeof snapshot === 'object' ? (snapshot as { active?: unknown }).active : undefined
    if (typeof active === 'string') return active
  } catch {
    // 快照拿不到就用默认
  }
  return 'zh'
}
