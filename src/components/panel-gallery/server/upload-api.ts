import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { ensureDir } from '../../../shared/host/paths.js'
import { readPngTextChunks } from './scan/index.js'
import { sendJson } from '../../../shared/http/respond.js'

/** 单张参考图上限。超过这个体积基本不是给人填进工作流的。 */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024

/** 认的图片类型。 */
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
}

/** 读原始请求体（带上限）。 */
async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > limit) throw new Error(`文件超过 ${Math.round(limit / 1024 / 1024)} MB`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** 文件名净化：只留安全字符，避免 `../` 之类的东西进到路径里。 */
function safeName(filename: string, ext: string): string {
  const base = path.basename(filename, path.extname(filename))
  const cleaned = base.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return `${cleaned === '' ? 'image' : cleaned}${ext}`
}

/**
 * `POST /comfyui-workbench/api/upload?filename=…`：接收一张参考图。
 *
 * 走**二进制直传**而不是 base64：省掉三分之一的体积，也不用在服务端解一次编码。
 * 浏览器的 `File` 只有后端能落成绝对路径，而工作流的 `input_image` 要的正是绝对路径。
 *
 * @param uploadsDir - 上传目录（绝对路径）。
 */
export function createUploadHandler(
  uploadsDir: string,
): (url: URL, res: ServerResponse, req: IncomingMessage) => Promise<void> {
  return async (url, res, req) => {
    const filename = url.searchParams.get('filename') ?? ''
    const ext = path.extname(filename).toLowerCase() || '.png'
    const mime = MIME_BY_EXT[ext]
    if (mime === undefined) {
      sendJson(res, 400, {
        ok: false,
        error: 'unsupported-type',
        message: `不支持的图片格式：${ext || '(无扩展名)'}。支持 ${Object.keys(MIME_BY_EXT).join(' / ')}`,
      })
      return
    }

    let bytes: Buffer
    try {
      bytes = await readRawBody(req, MAX_UPLOAD_BYTES)
    } catch (error) {
      sendJson(res, 413, { ok: false, error: 'too-large', message: error instanceof Error ? error.message : String(error) })
      return
    }
    if (bytes.length === 0) {
      sendJson(res, 400, { ok: false, error: 'empty', message: '文件是空的。' })
      return
    }

    // 至少校验一下魔数：不是所有调用方都老实给扩展名。
    const looksImage =
      (bytes[0] === 0x89 && bytes[1] === 0x50) || // PNG
      (bytes[0] === 0xff && bytes[1] === 0xd8) || // JPEG
      (bytes.toString('ascii', 0, 4) === 'RIFF') || // WEBP
      (bytes.toString('ascii', 0, 3) === 'GIF') || // GIF
      (bytes.toString('ascii', 4, 8) === 'ftyp') // AVIF
    if (!looksImage) {
      sendJson(res, 400, { ok: false, error: 'not-an-image', message: '文件内容不像图片。' })
      return
    }

    ensureDir(uploadsDir)
    // 时间戳 + 短哈希：同名的两张图不会互相覆盖，按时间排序也自然。
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const digest = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8)
    const target = path.join(uploadsDir, `${stamp}-${digest}-${safeName(filename, ext)}`)

    try {
      fs.writeFileSync(target, bytes)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: 'write-failed', message: error instanceof Error ? error.message : String(error) })
      return
    }

    const result: Record<string, unknown> = { ok: true, path: target, bytes: bytes.length, mime, name: path.basename(target) }
    // PNG 顺手给尺寸：界面要按比例占位，避免加载时跳动。
    if (ext === '.png') {
      const parsed = readPngTextChunks(target, bytes.length)
      if (parsed !== undefined && parsed.width > 0 && parsed.height > 0) {
        result.width = parsed.width
        result.height = parsed.height
      }
    }
    sendJson(res, 200, result)
  }
}
