import fs from 'node:fs'
import path from 'node:path'

import type { HostContext } from '../host/types.js'
import { canonical, comfyImageOutputDir } from './paths.js'

/** 一个授权根目录。 */
export interface RootEntry {
  path: string
  label: string
  /** custom | workspace | output | cwd */
  kind: string
}

/** 根目录集合缓存：一屏缩略图会打几十次请求，每次重算 realpath 没必要。 */
let rootsCache: { at: number; key: string; value: RootEntry[] } = { at: 0, key: '', value: [] }

/**
 * 本插件允许读取的根目录集合。
 *
 * 来源：显式配置 → 默认工作目录 → 全部 workspace → comfyui 的 outputDir → 进程 cwd。
 * 之所以不止一个：图片落在「生成时的项目根目录」，用户手上通常有好几个项目。
 *
 * @param ctx - 宿主上下文。
 * @param settings - 归一化配置（只用 roots）。
 */
export function rootsOf(ctx: HostContext, settings: { roots: string[] }): RootEntry[] {
  const cacheKey = settings.roots.join('|')
  const now = Date.now()
  if (rootsCache.key === cacheKey && now - rootsCache.at < 2000) return rootsCache.value

  const candidates: Array<{ path: string; kind: string }> = []
  for (const item of settings.roots) candidates.push({ path: item, kind: 'custom' })

  try {
    const cwd = ctx.get?.('workingDirectory') as { defaultDirectory?: unknown } | undefined
    const dir = cwd?.defaultDirectory
    if (typeof dir === 'string' && dir !== '') candidates.push({ path: dir, kind: 'workspace' })
  } catch {
    // 服务未挂载：下面还有其它来源
  }

  try {
    const registry = ctx.get?.('workspaceRegistry') as { list?: () => unknown } | undefined
    const list = typeof registry?.list === 'function' ? registry.list() : []
    if (Array.isArray(list)) {
      for (const workspace of list) {
        const p = workspace !== null && typeof workspace === 'object' ? (workspace as { path?: unknown }).path : undefined
        if (typeof p === 'string') candidates.push({ path: p, kind: 'workspace' })
      }
    }
  } catch {
    // 注册表不可用时忽略
  }

  const outputDir = comfyImageOutputDir()
  if (outputDir !== undefined) candidates.push({ path: outputDir, kind: 'output' })
  candidates.push({ path: process.cwd(), kind: 'cwd' })

  const seen = new Set<string>()
  const roots: RootEntry[] = []
  for (const candidate of candidates) {
    const abs = canonical(candidate.path)
    const key = abs.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    let exists = false
    try {
      exists = fs.statSync(abs).isDirectory()
    } catch {
      exists = false
    }
    if (!exists) continue
    roots.push({ path: abs, label: path.basename(abs) || abs, kind: candidate.kind })
  }

  rootsCache = { at: now, key: cacheKey, value: roots }
  return roots
}

/** 清空根目录缓存（配置变更或测试用）。 */
export function clearRootsCache(): void {
  rootsCache = { at: 0, key: '', value: [] }
}
