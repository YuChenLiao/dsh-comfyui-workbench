import fs from 'node:fs'
import path from 'node:path'

/** 用户主目录（Windows 与 POSIX 各取其一）。 */
export function homeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? ''
}

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

/**
 * 规范化路径：绝对、去尾分隔符、尽量解析 realpath。
 *
 * realpath 失败（路径还不存在）时退回绝对路径 —— 授权判断要在"文件尚未创建"
 * 的场景下也能给出结论。
 */
export function canonical(target: string): string {
  const abs = path.resolve(target)
  try {
    return fs.realpathSync.native(abs)
  } catch {
    return abs
  }
}
