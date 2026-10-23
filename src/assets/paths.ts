import fs from 'node:fs'
import path from 'node:path'

import { homeDir } from '../host/paths.js'

export { canonical, homeDir } from '../host/paths.js'

/**
 * `dsh-comfyui-image` 配置里的 outputDir（若用户显式指定过输出目录）。
 *
 * 这里刻意继续读**那个插件**的配置文件，而不是复制一份到本插件：
 * 用户已经在那儿配好了输出目录，复制一份就会漂移 —— 用户在一个地方改了目录，
 * 本插件仍在旧目录里找图，表现为"新图不见了"。
 */
export function comfyImageOutputDir(): string | undefined {
  const file = path.join(homeDir(), '.dsh-comfyui-image', 'config.json')
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    const dir = parsed !== null && typeof parsed === 'object' ? (parsed as { outputDir?: unknown }).outputDir : undefined
    return typeof dir === 'string' && dir.trim() !== '' ? dir : undefined
  } catch {
    return undefined
  }
}
