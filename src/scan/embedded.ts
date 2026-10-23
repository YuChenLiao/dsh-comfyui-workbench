import fs from 'node:fs'
import path from 'node:path'

import { extractFromGraph } from './graph.js'
import { readPngTextChunks } from './png-text.js'
import type { MetaRecord } from './types.js'

/**
 * 读 PNG 里内嵌的 ComfyUI 元数据。
 *
 * 这类图不是 `dsh-comfyui-image` 生成的（没有 `<图片>.json`），而是 ComfyUI 自己的
 * SaveImage 节点把 API 工作流写进了 `tEXt` 的 `prompt` 块。不读它，这类图就永远
 * 进不了「仅生成图」视图。
 *
 * @param imagePath - 图片路径。
 * @param stat - 文件信息。
 */
export function readEmbeddedMeta(imagePath: string, stat: fs.Stats): MetaRecord | undefined {
  if (path.extname(imagePath).toLowerCase() !== '.png') return undefined
  const parsed = readPngTextChunks(imagePath, stat.size)
  if (parsed === undefined) return undefined
  const promptChunk = parsed.chunks.find(chunk => chunk.keyword === 'prompt')
  if (promptChunk === undefined) return undefined

  let graph: unknown
  try {
    graph = JSON.parse(promptChunk.value)
  } catch {
    return undefined
  }
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return undefined

  const extracted = extractFromGraph(graph as MetaRecord)
  if (extracted === undefined) return undefined

  // 尺寸以 IHDR 为准：工作流里未必有 latent 节点，而像素尺寸永远存在。
  return {
    ...extracted,
    width: parsed.width ?? extracted.width,
    height: parsed.height ?? extracted.height,
    source: 'embedded',
  }
}

/**
 * 快速探测 PNG 是否带 ComfyUI 的 `prompt` 文本块。
 *
 * 扫描阶段只读文件头 256 字节，用来决定这张图算不算「生成图」；真正的解析留给
 * `readMeta`，误报会在那里被完整校验挡掉。
 *
 * @param imagePath - 图片路径。
 */
export function hasEmbeddedPromptHint(imagePath: string): boolean {
  if (path.extname(imagePath).toLowerCase() !== '.png') return false
  let fd: number | undefined
  try {
    fd = fs.openSync(imagePath, 'r')
    const buffer = Buffer.alloc(256)
    const read = fs.readSync(fd, buffer, 0, 256, 0)
    if (read < 64 || buffer[0] !== 0x89) return false
    const head = buffer.toString('latin1', 0, read)
    return head.includes('tEXt') && head.includes('prompt')
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
