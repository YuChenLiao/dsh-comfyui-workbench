import fs from 'node:fs'
import zlib from 'node:zlib'

import { PNG_META_READ_BYTES } from './constants.js'

/** PNG 里的一个文本块。 */
export interface PngTextChunk {
  keyword: string
  value: string
}

/** 文本块集合 + IHDR 里的真实像素尺寸。 */
export interface PngTextResult {
  chunks: PngTextChunk[]
  width: number
  height: number
}

/**
 * 读 PNG 的文本块（tEXt / zTXt / iTXt）。
 *
 * 元数据都在 IDAT 之前，遇到 IDAT 直接停 —— 后面的字节是像素数据，读了也白读。
 *
 * @param imagePath - 图片路径。
 * @param size - 文件大小（决定最多读多少）。
 */
export function readPngTextChunks(imagePath: string, size: number): PngTextResult | undefined {
  if (size < 16) return undefined
  const length = Math.min(size, PNG_META_READ_BYTES)
  let fd: number | undefined
  try {
    fd = fs.openSync(imagePath, 'r')
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(fd, buffer, 0, length, 0)
    if (read < 24) return undefined
    if (buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') return undefined

    // IHDR 是第一个块：宽高在偏移 16 / 20，这是图片的真实像素尺寸。
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)

    const chunks: PngTextChunk[] = []
    let offset = 8
    while (offset + 12 <= read) {
      const chunkLength = buffer.readUInt32BE(offset)
      const type = buffer.toString('ascii', offset + 4, offset + 8)
      if (type === 'IDAT' || type === 'IEND') break
      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        const data = buffer.subarray(offset + 8, Math.min(offset + 8 + chunkLength, read))
        const zero = data.indexOf(0)
        if (zero > 0) {
          const keyword = data.toString('latin1', 0, zero)
          let value: string | undefined
          try {
            if (type === 'tEXt') {
              value = data.toString('latin1', zero + 1)
            } else if (type === 'zTXt') {
              value = zlib.inflateSync(data.subarray(zero + 2)).toString('utf8')
            } else {
              const rest = data.subarray(zero + 3)
              const languageEnd = rest.indexOf(0)
              const translatedEnd = rest.indexOf(0, languageEnd + 1)
              value = rest.subarray(translatedEnd + 1).toString('utf8')
            }
          } catch {
            value = undefined
          }
          if (value !== undefined) chunks.push({ keyword, value })
        }
      }
      offset += 12 + chunkLength
    }
    return { chunks, width, height }
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
