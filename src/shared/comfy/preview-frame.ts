/**
 * 解析 ComfyUI 在 `/ws` 上推的二进制预览帧。
 *
 * ComfyUI 的潜空间预览（`--preview-method auto|latent2rgb|taesd`）不是 JSON，
 * 而是一条二进制消息，格式（`server.py` 的 `send_image` / `BinaryEventTypes`）：
 *
 * ```
 * [0..3]   event type   big-endian uint32，1 = PREVIEW_IMAGE
 * [4..7]   image type   big-endian uint32，1 = JPEG，2 = PNG
 * [8..]    image bytes
 * ```
 *
 * 抽成独立函数是因为它**只认字节、不认 socket**：这样能直接在单测里喂构造帧，
 * 不需要起一个假 WebSocket。解析失败一律返回 `null` —— 预览是锦上添花，
 * 任何一条畸形帧都不该影响百分比进度与出图本身。
 */

/** 一帧可用的预览图。 */
export interface PreviewFrame {
  /** `image/jpeg` 或 `image/png`。 */
  mime: string
  /** 图像字节（不含前面 8 字节头）。 */
  bytes: Uint8Array
}

/** `BinaryEventTypes.PREVIEW_IMAGE`。 */
const EVENT_PREVIEW_IMAGE = 1

/** 图像格式码。 */
const IMAGE_TYPE_JPEG = 1
const IMAGE_TYPE_PNG = 2

/** 头部长度：4 字节事件类型 + 4 字节图像类型。 */
const HEADER_BYTES = 8

/**
 * 把一条二进制 WebSocket 消息解析成预览帧。
 *
 * @param data - 原始字节（`ArrayBuffer` 或任意 TypedArray/DataView）。
 * @returns 可用的帧；不是预览帧、格式未知或长度不足时返回 `null`。
 */
export function parsePreviewFrame(data: ArrayBuffer | ArrayBufferView): PreviewFrame | null {
  const bytes = toUint8(data)
  if (bytes.byteLength < HEADER_BYTES + 1) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, false) !== EVENT_PREVIEW_IMAGE) return null

  const imageType = view.getUint32(4, false)
  const mime = imageType === IMAGE_TYPE_JPEG
    ? 'image/jpeg'
    : imageType === IMAGE_TYPE_PNG
      ? 'image/png'
      : null
  if (mime === null) return null

  // 复制一份再交出去：调用方会长期持有这帧，而原始缓冲可能被复用。
  return { mime, bytes: bytes.slice(HEADER_BYTES) }
}

/**
 * 把 WebSocket 的 `event.data` 归一成字节视图。
 *
 * 浏览器给 `Blob`，Node 的 `ws`/内置 WebSocket 给 `ArrayBuffer` 或 `Buffer`；
 * 这里只处理后两类（`Blob` 需要异步 `arrayBuffer()`，而 `watchProgress` 的
 * message 回调是同步的 —— 遇到 `Blob` 直接放弃这一帧，不影响后续）。
 *
 * @param data - 未定类型的事件数据。
 * @returns 字节视图；不是二进制载荷时返回 `null`。
 */
export function bytesOfMessage(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return null
}

function toUint8(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}
