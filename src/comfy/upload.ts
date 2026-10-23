import fs from 'node:fs'
import path from 'node:path'

import type { ComfyClient } from './client.js'
import { RunError } from './errors.js'

/** ComfyUI `/upload/image` 的返回。 */
export interface UploadedImage {
  /** 提交工作流时该填的文件名（含 subfolder 前缀）。 */
  name: string
  subfolder: string
}

/**
 * 把本地图片送进 ComfyUI 的 input 目录，返回可提交的文件名。
 *
 * 为什么必须这么做：`LoadImage` 这类节点读的是 ComfyUI **自己 input 目录**里的文件，
 * 传绝对路径会被判成 `Invalid image file`。用户在上传器里选的图在插件目录下，
 * 所以提交前要先搬过去。
 *
 * 已经是"文件名"（不含路径分隔符）的值原样返回 —— 说明用户自己填了 ComfyUI 里的名字。
 *
 * @param client - ComfyUI 客户端。
 * @param value - 变量值（本地绝对路径或已存在的文件名）。
 */
export async function ensureComfyImage(client: ComfyClient, value: string): Promise<string> {
  const looksLocal = /[\\/]/.test(value) || path.isAbsolute(value)
  if (!looksLocal) return value

  let bytes: Buffer
  try {
    bytes = fs.readFileSync(value)
  } catch (error) {
    throw new RunError(
      'variable_type',
      `读不到这张图：${value}`,
      '确认文件还在；上传器给的路径会落在插件的 uploads 目录里。',
      error,
    )
  }

  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), path.basename(value))
  form.append('overwrite', 'true')

  const res = await client.uploadImage(form)
  const subfolder = res.subfolder === '' ? '' : `${res.subfolder}/`
  return `${subfolder}${res.name}`
}

/**
 * 把 vars 里所有"图像类"值换成 ComfyUI 认的文件名。
 *
 * 只处理 image / mask 类型的槽位：别的字符串变量哪怕长得像路径也不碰，
 * 免得把提示词里的斜杠当成文件路径。
 */
export async function materializeImages(
  client: ComfyClient,
  vars: Record<string, unknown>,
  imageSlots: readonly string[],
): Promise<{ vars: Record<string, unknown>; notes: string[] }> {
  const next = { ...vars }
  const notes: string[] = []
  for (const name of imageSlots) {
    const value = next[name]
    if (typeof value !== 'string' || value === '') continue
    const before = value
    const after = await ensureComfyImage(client, value)
    if (after !== before) {
      next[name] = after
      notes.push(`${name}：本地图已送进 ComfyUI 的 input，提交时用文件名 ${after}。`)
    }
  }
  return { vars: next, notes }
}
