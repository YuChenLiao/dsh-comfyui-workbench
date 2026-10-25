import type { HostContext, LoggerLike } from './types.js'

/**
 * 解析宿主 logger。
 *
 * 实测：cordis 的 logger 是 `ctx.logger(scope)` 这个**属性函数**，不走 provide/get。
 * `ctx.get('logger')` 恒为 undefined —— 早期版本用它取 logger，结果写入失败被全部吞掉。
 * 这里按「属性函数 → 属性对象 → get」三路兜底，取不到就返回 undefined，由调用方降级。
 *
 * @param ctx - 宿主上下文。
 * @param scope - 日志作用域名，出现在每行前缀里。
 */
export function resolveLogger(ctx: HostContext, scope: string): LoggerLike | undefined {
  const direct = ctx.logger
  if (typeof direct === 'function') {
    try {
      const scoped = (direct as (name: string) => unknown)(scope)
      if (scoped !== null && typeof scoped === 'object') return scoped as LoggerLike
    } catch {
      // 取不到就走下面的兜底
    }
  }
  if (direct !== null && typeof direct === 'object') return direct as LoggerLike
  const viaGet = ctx.get?.('logger')
  if (viaGet !== null && typeof viaGet === 'object') return viaGet as LoggerLike
  return undefined
}
