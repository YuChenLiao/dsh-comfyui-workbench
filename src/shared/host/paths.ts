import fs from 'node:fs'
import path from 'node:path'

/** 用户主目录（Windows 与 POSIX 各取其一）。 */
export function homeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? ''
}

/**
 * 本插件的数据目录（`~/.dsh-comfyui-workbench`）。
 *
 * 只放"插件自己产生的东西"：工作流模板、变量声明、运行记录、索引库。
 * 产物文件不在这里 —— 它们留在用户的输出目录，插件只记指针。
 */
export function pluginDataDir(): string {
  return path.join(homeDir(), '.dsh-comfyui-workbench')
}

/** 工作流模板目录。 */
export function workflowsDir(): string {
  return path.join(pluginDataDir(), 'workflows')
}

/** 运行记录目录。 */
export function runsDir(): string {
  return path.join(pluginDataDir(), 'runs')
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

/** 确保目录存在（并发安全：mkdir recursive 本身幂等）。 */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * 路径比较用的折叠。
 *
 * Windows 文件系统大小写不敏感，POSIX 敏感 —— 一律 toLowerCase 会让
 * `/data/App` 与 `/data/app` 被当成同一个目录。授权校验、根去重、缩略图缓存
 * 都必须用同一套规则，否则会出现"校验放行、实际操作的是另一个文件"。
 *
 * @param value - 原始路径。
 */
export function foldPathCase(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}
