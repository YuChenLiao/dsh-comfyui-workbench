import fs from 'node:fs'
import path from 'node:path'

import { SIDECAR_MAX_BYTES } from './constants.js'
import { readEmbeddedMeta } from './embedded.js'
import type { MetaRecord } from './types.js'

/** 元数据缓存条目：按 sidecar 与图片两层 mtime 失效。 */
interface MetaCacheEntry {
  sidecarMtimeMs: number
  imageMtimeMs: number
  meta: MetaRecord | undefined
}

const metaCache = new Map<string, MetaCacheEntry>()

/**
 * 一张图片的 sidecar 路径。
 *
 * @param imagePath - 图片绝对路径。
 */
export function sidecarPathOf(imagePath: string): string {
  return `${imagePath}.json`
}

/**
 * 读取一张图片的元数据：优先同名 sidecar，缺失时回退到 PNG 内嵌工作流。
 *
 * 任何读取或解析失败都返回 undefined —— 资产库不该因为一个坏文件整体失败。
 *
 * @param imagePath - 图片绝对路径。
 */
export function readMeta(imagePath: string): MetaRecord | undefined {
  const metaPath = sidecarPathOf(imagePath)

  let sidecarStat: fs.Stats | undefined
  let imageStat: fs.Stats | undefined
  try {
    sidecarStat = fs.statSync(metaPath)
  } catch {
    sidecarStat = undefined
  }
  try {
    imageStat = fs.statSync(imagePath)
  } catch {
    imageStat = undefined
  }

  const sidecarKey = sidecarStat !== undefined && sidecarStat.isFile() ? sidecarStat.mtimeMs : -1
  const imageKey = imageStat !== undefined ? imageStat.mtimeMs : -1
  const cached = metaCache.get(imagePath)
  if (cached !== undefined && cached.sidecarMtimeMs === sidecarKey && cached.imageMtimeMs === imageKey) {
    return cached.meta
  }

  let meta: MetaRecord | undefined
  if (
    sidecarStat !== undefined &&
    sidecarStat.isFile() &&
    sidecarStat.size > 0 &&
    sidecarStat.size <= SIDECAR_MAX_BYTES
  ) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = { ...(parsed as MetaRecord), source: 'sidecar' }
      }
    } catch {
      meta = undefined
    }
  }

  if (meta === undefined && imageStat !== undefined && imageStat.isFile()) {
    meta = readEmbeddedMeta(imagePath, imageStat)
  }

  metaCache.set(imagePath, { sidecarMtimeMs: sidecarKey, imageMtimeMs: imageKey, meta })
  return meta
}

/**
 * 兼容旧调用点：同名 sidecar 或内嵌元数据。
 *
 * @param imagePath - 图片绝对路径。
 */
export function readSidecar(imagePath: string): MetaRecord | undefined {
  return readMeta(imagePath)
}

/**
 * 读取完整元数据（含 workflow）。导出工作流时用。
 *
 * @param imagePath - 图片绝对路径。
 */
export function readFullSidecar(imagePath: string): MetaRecord | undefined {
  return readMeta(imagePath)
}

/** 清空元数据缓存（删除、修复之后调用，避免读到旧值）。 */
export function clearMetaCache(): void {
  metaCache.clear()
}

/** 丢弃单个路径的缓存条目。 */
export function forgetMeta(imagePath: string): void {
  metaCache.delete(imagePath)
}
