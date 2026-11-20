/**
 * 回收站：删除先进 `.trash/`，可以恢复或彻底清空。
 *
 * ## 为什么需要它
 *
 * 产物旁边那张 `.json` sidecar 是"再来一张一模一样的"的唯一凭据。误删一张图，
 * 丢的不只是一张图，是那一整组参数（seed / prompt / 工作流版本）。面板上删除是
 * 一次点击，所以至少要能撤回一次。
 *
 * ## 目录布局
 *
 * ```
 * <root>/.trash/<stamp>-<rand>/
 *   .restore.json        ← { original: 原绝对路径, trashedAt }
 *   原文件名
 *   原文件名.json         ← sidecar 跟着走，恢复时一起回来
 * ```
 *
 * 用**每份一个目录**而不是平铺：同一张图可以被删两次（恢复后再删），平铺会撞名；
 * 而且 manifest 与文件放一起，清空时 `rm -rf` 一个目录就够，不会留下半份。
 *
 * 恢复用 `rename` 而不是复制：跨盘时才退回复制 + 删除（`rename` 会抛 EXDEV）。
 */
import fs from 'node:fs'
import path from 'node:path'

import { canonical } from '../../../../shared/authz/legacy-paths.js'
import { foldPathCase } from '../../../../shared/host/paths.js'
import type { RootEntry } from '../../../../shared/authz/roots.js'

/** 回收站目录名。**必须同时加进 `SKIP_DIRS`**，否则删掉的图会重新出现在列表里。 */
export const TRASH_DIRNAME = '.trash'

/** 每份删除的记录文件。 */
const MANIFEST = '.restore.json'

export interface TrashEntry {
  /** 这一份在回收站里的目录（绝对路径）。 */
  dir: string
  /** 图片现在的绝对路径。 */
  path: string
  /** 原来的绝对路径（恢复的目标）。 */
  original: string
  name: string
  bytes: number
  trashedAt: string
}

/** `target` 属于哪个授权根（最长前缀）。 */
function rootOf(target: string, roots: readonly RootEntry[]): RootEntry | undefined {
  const abs = foldPathCase(canonical(target))
  let best: RootEntry | undefined
  let bestLength = -1
  for (const root of roots) {
    const base = foldPathCase(root.path)
    const inside = abs === base || abs.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`)
    if (inside && base.length > bestLength) {
      best = root
      bestLength = base.length
    }
  }
  return best
}

/** 一个根下的回收站目录。 */
export function trashDirOf(root: RootEntry): string {
  return path.join(root.path, TRASH_DIRNAME)
}

/** 路径是否落在某个根的回收站里（恢复/清空都要先过这道）。 */
export function isInsideTrash(target: string, roots: readonly RootEntry[]): boolean {
  const root = rootOf(target, roots)
  if (root === undefined) return false
  const trash = foldPathCase(trashDirOf(root))
  const abs = foldPathCase(canonical(target))
  return abs === trash || abs.startsWith(`${trash}${path.sep}`)
}

/** 把一张图（连 sidecar）移进回收站。 */
export function trashOne(
  target: string,
  roots: readonly RootEntry[],
): { ok: true; dir: string; original: string; sidecarMoved: boolean } | { ok: false; error: string; code: string } {
  const root = rootOf(target, roots)
  if (root === undefined) return { ok: false, error: '这个路径不在资产库的白名单里。', code: 'forbidden' }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 8)
  const dir = path.join(trashDirOf(root), `${stamp}-${rand}`)
  const name = path.basename(target)

  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify({ original: target, trashedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    fs.renameSync(target, path.join(dir, name))
  } catch (error) {
    // 半途失败就把目录收掉，别在回收站里留一份没有记录的残骸
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 收不掉就算了 */ }
    return { ok: false, error: `移入回收站失败：${error instanceof Error ? error.message : String(error)}`, code: 'trash-failed' }
  }

  // sidecar 跟着走：恢复时它必须一起回来（没有它就没法「再来一张」）
  let sidecarMoved = false
  const sidecar = `${target}.json`
  try {
    if (fs.existsSync(sidecar)) {
      fs.renameSync(sidecar, path.join(dir, `${name}.json`))
      sidecarMoved = true
    }
  } catch {
    // sidecar 没移成功不算失败：图已经安全了。但要如实告诉调用方 ——
    // 原路径上会留一个孤儿 `.json`，用户该知道"参数记录没跟着走"
  }

  return { ok: true, dir, original: target, sidecarMoved }
}

/** 列出所有根下的回收站内容（新的在前）。 */
export function listTrash(roots: readonly RootEntry[]): TrashEntry[] {
  const out: TrashEntry[] = []
  for (const root of roots) {
    const trash = trashDirOf(root)
    let dirs: fs.Dirent[]
    try {
      dirs = fs.readdirSync(trash, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue
      const dir = path.join(trash, entry.name)
      let manifest: { original?: unknown; trashedAt?: unknown }
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')) as typeof manifest
      } catch {
        continue
      }
      const original = typeof manifest.original === 'string' ? manifest.original : ''
      if (original === '') continue
      const name = path.basename(original)
      const image = path.join(dir, name)
      let bytes = 0
      try {
        bytes = fs.statSync(image).size
      } catch {
        // 文件已经不在了：仍然列出来，用户能清掉这条记录
      }
      out.push({
        dir,
        path: image,
        original,
        name,
        bytes,
        trashedAt: typeof manifest.trashedAt === 'string' ? manifest.trashedAt : entry.name,
      })
    }
  }
  return out.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt))
}

/**
 * 从回收站恢复一份。
 *
 * @param dir - 回收站里那一份的目录（来自 `listTrash`）。
 * @param roots - 授权根。
 */
export function restoreTrash(
  dir: string,
  roots: readonly RootEntry[],
): { ok: true; restored: string } | { ok: false; error: string; code: string } {
  // 必须真的在回收站里：`dir` 来自客户端，不校验的话 `../..` 能把它指到任何地方
  if (isInsideTrash(dir, roots) === false) {
    return { ok: false, error: '不在回收站里。', code: 'forbidden' }
  }
  let manifest: { original?: unknown }
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')) as typeof manifest
  } catch {
    return { ok: false, error: '这条记录已损坏，读不回原路径。', code: 'bad-entry' }
  }
  const original = typeof manifest.original === 'string' ? manifest.original : ''
  if (original === '') return { ok: false, error: '这条记录没有原路径。', code: 'bad-entry' }
  // 原路径也要在授权根内：回收站记录可能来自别的授权范围（换了配置之后）
  if (rootOf(original, roots) === undefined) {
    return { ok: false, error: '原路径已经不在资产库的白名单里（配置变了？）。', code: 'forbidden' }
  }

  const name = path.basename(original)
  const from = path.join(dir, name)
  /**
   * 目标路径：同名文件已经回来了（用户删完之后又生成了同名图，或者**两张同名图
   * 先后进了回收站**）时循环加后缀。
   *
   * 只查一次 `original` 是不够的：`renameSync` 在 Windows/POSIX 都会**覆盖**既有文件，
   * 于是"恢复第一条 → 得到 x-restored.png；恢复第二条 → 同一条路径被覆盖"，
   * 两次都回 ok:true，第一条恢复回来的图被静默顶掉。
   */
  const ext = path.extname(original)
  const stem = original.slice(0, original.length - ext.length)
  const taken = (candidate: string): boolean => fs.existsSync(candidate) || fs.existsSync(`${candidate}.json`)
  let target = original
  if (taken(target)) {
    target = `${stem}-restored${ext}`
    for (let index = 2; taken(target) && index < 1000; index += 1) {
      target = `${stem}-restored-${index}${ext}`
    }
  }
  // 后缀拼出来的路径也可能越界（`original` 正好是根本身时）：再核一次
  if (rootOf(target, roots) === undefined) {
    return { ok: false, error: '恢复目标不在资产库的白名单里。', code: 'forbidden' }
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    try {
      fs.renameSync(from, target)
    } catch (error) {
      if ((error as { code?: string }).code !== 'EXDEV') throw error
      // 跨盘：复制 + 删除
      fs.copyFileSync(from, target)
      fs.unlinkSync(from)
    }
  } catch (error) {
    return { ok: false, error: `恢复失败：${error instanceof Error ? error.message : String(error)}`, code: 'restore-failed' }
  }

  const sidecar = path.join(dir, `${name}.json`)
  try {
    if (fs.existsSync(sidecar)) fs.renameSync(sidecar, `${target}.json`)
  } catch {
    // sidecar 恢复失败不影响图：那张图只是会变成"没有配方"的普通图
  }

  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // 目录清不掉就留着，下次清空还会扫到
  }
  return { ok: true, restored: target }
}

/**
 * 清空回收站。
 *
 * **只删"我们造的那些"**：目录里必须有可解析的 `.restore.json`。
 * 授权根下可能本来就有用户自己的 `.trash`（不少工具用这个约定）——
 * 对 `readdirSync` 出来的每个条目直接 `rm -rf` 会把别人的东西一起删掉，
 * 而这是一次点击的不可逆操作。
 */
export function emptyTrash(roots: readonly RootEntry[]): { removed: number; skipped: number } {
  let removed = 0
  let skipped = 0
  for (const root of roots) {
    const trash = trashDirOf(root)
    let dirs: fs.Dirent[]
    try {
      dirs = fs.readdirSync(trash, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of dirs) {
      if (entry.isDirectory() === false) {
        skipped += 1
        continue
      }
      const dir = path.join(trash, entry.name)
      // 不是我们造的（没有 manifest）就别碰
      if (fs.existsSync(path.join(dir, MANIFEST)) === false) {
        skipped += 1
        continue
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true })
        removed += 1
      } catch {
        // 删不掉的跳过（可能被占用）
        skipped += 1
      }
    }
  }
  return { removed, skipped }
}
