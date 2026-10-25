import type { ComfySupervisor } from '../../../shared/comfy/index.js'
import { sendJson } from '../../../shared/http/respond.js'

/**
 * `GET /comfyui-workbench/api/service`：服务状态。
 *
 * 暴露 state / managed / pid / installDir / detail，用于排障：
 * 用户看到的"连不上"到底是没装、没拉起、还是拉起来但没就绪。
 *
 * @param supervisor - 服务托管实例。
 */
export function handleServiceStatus(
  supervisor: ComfySupervisor,
  _url: URL,
  res: import('node:http').ServerResponse,
): void {
  sendJson(res, 200, { ok: true, service: supervisor.status() })
}

/**
 * `POST /comfyui-workbench/api/service/stop`：停掉自己拉起的进程。
 *
 * 外部实例不会被停 —— 这是托管的基本边界，接口也不给它开后门。
 */
export function handleServiceStop(
  supervisor: ComfySupervisor,
  _url: URL,
  res: import('node:http').ServerResponse,
): void {
  const stopped = supervisor.stop()
  sendJson(res, 200, {
    ok: true,
    stopped,
    service: supervisor.status(),
    ...(stopped ? {} : { message: '没有本插件拉起的进程，未停止任何东西。' }),
  })
}
