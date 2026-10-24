import type { Settings } from '../host/config.js'
import { sendJson } from './respond.js'

/**
 * `GET /comfyui-workbench/api/config`：界面需要的只读配置。
 *
 * 只暴露路径与地址，不暴露 headers 之类的凭据。
 */
export function createConfigHandler(deps: {
  settings: Settings
  outputDir: string
  uploadsDir: string
  workflowsDir: string
  /** 产物目录是怎么定下来的：配置 / 工作区 / 数据目录。 */
  outputSource?: 'config' | 'env' | 'service' | 'cwd' | 'data'
}): (url: URL, res: import('node:http').ServerResponse) => void {
  return (_url, res) => {
    sendJson(res, 200, {
      ok: true,
      config: {
        baseUrl: deps.settings.baseUrl,
        outputDir: deps.outputDir,
        outputSource: deps.outputSource ?? 'config',
        uploadsDir: deps.uploadsDir,
        workflowsDir: deps.workflowsDir,
        runMode: deps.settings.runMode,
        returnImages: deps.settings.returnImages,
        timeoutMs: deps.settings.timeoutMs,
      },
    })
  }
}
