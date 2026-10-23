import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { homeDir } from './paths.js'

/** 缩略图边长上限。一屏几十张，原图直出会有上百 MB。 */
const THUMB_EDGE = 360

/** sharp 实例的最小面（只声明用到的链式方法）。 */
interface SharpInstance {
  rotate: () => SharpInstance
  resize: (options: Record<string, unknown>) => SharpInstance
  webp: (options: Record<string, unknown>) => SharpInstance
  toFile: (target: string) => Promise<unknown>
}

type SharpFactory = (input: string, options?: Record<string, unknown>) => SharpInstance

let sharpPromise: Promise<SharpFactory | null> | null = null

/**
 * 解析 sharp。
 *
 * link 安装时插件的物理路径不在 profile 的 node_modules 下，裸 `import('sharp')`
 * 会直接解析失败；所以再按 profile / dsh 安装树兜底。全都拿不到就安静回退原图 ——
 * 缩略图是优化，不是功能前提。
 */
function tryImportSharp(): Promise<SharpFactory | null> {
  const specifier = 'sharp'
  return import(/* @vite-ignore */ specifier)
    .then((mod: unknown) => {
      const bag = mod as { default?: unknown }
      return (bag.default ?? mod) as SharpFactory
    })
    .catch(async () => {
      const bases: string[] = []
      if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
        bases.push(process.env.DSH_PROFILE_DIR)
      }
      const home = homeDir()
      if (home !== '') bases.push(path.join(home, '.dsh', 'profiles'))
      bases.push(path.join(path.dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh'))

      for (const base of bases) {
        try {
          const req = createRequire(path.join(base, 'package.json'))
          const resolved = req.resolve('sharp') as string
          const mod = (await import(pathToFileURL(resolved).href)) as { default?: unknown }
          return (mod.default ?? mod) as SharpFactory
        } catch {
          // 换下一个候选根
        }
      }
      return null
    })
}

/** 惰性加载 sharp：只加载一次，失败后永久回退原图。 */
export function loadSharp(): Promise<SharpFactory | null> {
  if (sharpPromise === null) sharpPromise = tryImportSharp()
  return sharpPromise
}

/** 缩略图缓存目录。 */
export function thumbDir(): string {
  return path.join(os.tmpdir(), 'dsh-comfyui-workbench-thumbs')
}

/**
 * 一张图对应的缩略图缓存路径（按路径 + mtime + 大小 + 边长定键）。
 *
 * 键里带 mtime：原图变了，键就变，旧缓存自然失效，不需要额外清理逻辑。
 *
 * @param target - 原图绝对路径。
 * @param stat - 原图 stat。
 */
export function thumbPathFor(target: string, stat: fs.Stats): string {
  const key = crypto
    .createHash('sha1')
    .update(`${target.toLowerCase()}|${stat.mtimeMs}|${stat.size}|${THUMB_EDGE}`)
    .digest('hex')
  return path.join(thumbDir(), `${key}.webp`)
}

/**
 * 生成（或复用）一张图片的缩略图。
 *
 * @param target - 原图绝对路径。
 * @param stat - 原图 stat（用于缓存键）。
 * @returns 缩略图路径；无法生成时 undefined（调用方回退原图）。
 */
export async function ensureThumb(target: string, stat: fs.Stats): Promise<string | undefined> {
  const sharp = await loadSharp()
  if (sharp === null) return undefined
  const dir = thumbDir()
  const file = thumbPathFor(target, stat)

  try {
    if (fs.statSync(file).size > 0) return file
  } catch {
    // 还没生成，往下走
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await sharp(target, { animated: false, limitInputPixels: 268435456 })
      .rotate()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(temp)
    // 先写临时文件再 rename：并发请求不会读到半个文件。
    fs.renameSync(temp, file)
    return file
  } catch {
    return undefined
  }
}
