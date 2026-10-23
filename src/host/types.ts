/**
 * 宿主能力的最小面。
 *
 * 这里刻意不 import `@deepseek-ai/cordis` 的类型：link 安装时插件的物理路径
 * 不在 profile 的 node_modules 下，引用宿主类型会让类型解析随安装方式漂移。
 * 只声明我们真正用到的那几个成员，形状对齐即可 —— 与 dsh-comfyui-image 的做法一致。
 */

/** cordis 的 logger 对象（`ctx.logger(scope)` 的返回值）。 */
export interface LoggerLike {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
}

/** 注册类调用返回的销毁函数。 */
export type Disposer = () => void

/** 宿主上下文的最小面。 */
export interface HostContext {
  get?: (name: string) => unknown
  effect?: (run: () => void | Disposer, label?: string) => void
  logger?: unknown
  inject?: (names: string[], run: (scope: HostContext) => void) => void
}

/** webServer 服务的注册面（只用到 prefix 形状）。 */
export interface WebServerLike {
  register: (route: { kind: 'prefix'; path: string; handler: HttpHandler }) => Disposer
}

/** HTTP handler。 */
export type HttpHandler = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) => void | Promise<void>
