/**
 * 姿势线稿的取图层：把第三方图床上的图，按需取回来给面板与工作流用。
 *
 * ## 为什么图不随包
 *
 * 线稿的著作权不在本项目，上游明确写了不得用于商业用途。所以仓库里只有名称、
 * 分类与图地址（见 `data/poses/NOTICE.md`），图一律运行时读取 —— 谁要用谁承担
 * 那一份使用限制，仓库不替任何人把图转述成自己的。
 *
 * ## 比"照着上游做"多做的四件事
 *
 * 1. **磁盘缓存**：上游（澜姿）只有 80 条内存缓存，进程一重启全丢，每次首屏都重新
 *    下载 40 张缩略图。这里落盘，第二次打开是本地读。
 * 2. **单飞**：面板一次打开会并发请求几十张封面的同一个 id（列表 + 详情 + 截图预览），
 *    不合并就会对同一张图打出 N 个请求。
 * 3. **失败冷却**：远端挂了的时候，上游是每个请求各等 20 秒再报错，面板就卡死。
 *    这里连续失败几次就短路一段时间，直接告诉调用方"上游暂时读不到"，
 *    而不是让几十个面板请求各自挂在超时上。
 * 4. **校验到字节头**：只认 PNG / JPEG 的 magic bytes。扩展名是别人给的，
 *    不该当成类型保证。
 *
 * ## 安全边界
 *
 * 代理天然是个 SSRF 出口，所以三道闸都要在：路径白名单、origin 固定为 https、
 * 响应大小上下界。**任何一道放宽都必须过测试。**
 */
import fs from 'node:fs'
import path from 'node:path'

/** 允许的相对路径。与 `scripts/import-poses.mjs` 里那条必须完全一致。 */
const SAFE_PATH = /^(thumbs|img)\/[A-Za-z0-9_]+\.(jpg|png)$/

/** 响应大小上下界：太小不是图，太大不该是线稿缩略图。 */
const MIN_BYTES = 32
const MAX_BYTES = 8_000_000

/** 内存里留多少张。缩略图约 15 KB，原图 200-400 KB，32 张足够一轮翻页。 */
const MEMORY_LIMIT = 32

/** 磁盘缓存上限。1000 张原图约 300 MB，超过就按最久未用的删。 */
const DISK_LIMIT_BYTES = 256 * 1024 * 1024

/** 连续失败几次开始冷却，冷却多久。 */
const FAIL_THRESHOLD = 3
const COOLDOWN_MS = 30_000

export interface PoseImage {
  mediaType: string
  buffer: Buffer
  /** 这次是从哪拿到的，面板与测试都用得上。 */
  from: 'memory' | 'disk' | 'network'
}

export interface PoseImageStats {
  memoryEntries: number
  diskFiles: number
  diskBytes: number
  /** 冷却期剩余毫秒数；0 表示当前正常。 */
  cooldownRemainingMs: number
}

export interface PoseImages {
  fetch: (relativePath: string) => Promise<PoseImage>
  /** 取回并落盘到一个指定目录，返回绝对路径。给"当工作流输入图"用。 */
  materialize: (relativePath: string, dir: string) => Promise<{ file: string; mediaType: string }>
  stats: () => PoseImageStats
}

export interface PoseImagesOptions {
  /** 磁盘缓存目录。 */
  cacheDir: string
  /** 上游图床根地址，必须 https。 */
  origin: string
  fetchImpl?: typeof fetch
  now?: () => number
  memoryLimit?: number
  diskLimitBytes?: number
}

function mediaTypeOf(buffer: Buffer): string | undefined {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  return undefined
}

/**
 * 建一个取图器。
 *
 * @param options - 缓存目录、上游根地址、可注入的 fetch 与时钟（测试要能把时间和网络都钉住）。
 */
export function createPoseImages(options: PoseImagesOptions): PoseImages {
  const { cacheDir, origin, fetchImpl = fetch, now = Date.now } = options
  const memoryLimit = options.memoryLimit ?? MEMORY_LIMIT
  const diskLimitBytes = options.diskLimitBytes ?? DISK_LIMIT_BYTES

  if (!/^https:\/\//.test(origin)) throw new Error(`姿势图上游必须是 https：${origin}`)

  /** 内存 LRU：Map 的插入顺序即使用顺序，命中时重新插入即"提到最新"。 */
  const memory = new Map<string, PoseImage>()
  /** 单飞：同一个路径的并发请求共享一次下载。 */
  const inflight = new Map<string, Promise<PoseImage>>()
  let failures = 0
  /** 上一次失败的时刻。用来判断"连续"：间隔太久就不该继续累加。 */
  let lastFailureAt = 0
  let cooldownUntil = 0

  const diskPathOf = (relativePath: string): string => path.join(cacheDir, relativePath)

  const remember = (key: string, value: PoseImage): void => {
    if (memory.has(key)) memory.delete(key)
    memory.set(key, value)
    while (memory.size > memoryLimit) {
      const oldest = memory.keys().next().value
      if (oldest === undefined) break
      memory.delete(oldest)
    }
  }

  const readDisk = (relativePath: string): PoseImage | undefined => {
    try {
      const file = diskPathOf(relativePath)
      const buffer = fs.readFileSync(file)
      const mediaType = mediaTypeOf(buffer)
      if (mediaType === undefined || buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) return undefined
      // 读到了就把 mtime 顶上去，让"最久未用"的判定真的按使用算
      const stamp = new Date()
      try {
        fs.utimesSync(file, stamp, stamp)
      } catch {
        // 时间戳改不动不影响读
      }
      return { mediaType, buffer, from: 'disk' }
    } catch {
      return undefined
    }
  }

  /**
   * 清理磁盘缓存。**在写入之后异步跑**，不阻塞这次请求。
   *
   * 用同步的文件操作而不是流：姿势图规模小、数量有限，简单胜过并发安全上的花样。
   */
  const pruneDisk = (): void => {
    const files: Array<{ file: string; size: number; at: number }> = []
    for (const sub of ['thumbs', 'img']) {
      const dir = path.join(cacheDir, sub)
      let names: string[] = []
      try {
        names = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const name of names) {
        const file = path.join(dir, name)
        try {
          const stat = fs.statSync(file)
          if (stat.isFile()) files.push({ file, size: stat.size, at: stat.atimeMs })
        } catch {
          // 并发删掉了就算了
        }
      }
    }
    const total = files.reduce((sum, item) => sum + item.size, 0)
    if (total <= diskLimitBytes) return
    files.sort((a, b) => a.at - b.at)
    let left = total
    for (const item of files) {
      if (left <= diskLimitBytes) break
      try {
        fs.unlinkSync(item.file)
        left -= item.size
      } catch {
        // 删不掉就跳过，下次再试
      }
    }
  }

  const download = async (relativePath: string): Promise<PoseImage> => {
    if (!SAFE_PATH.test(relativePath)) throw new Error('姿势图路径无效')

    // **磁盘优先于冷却**：冷却说的是"上游现在不行"，磁盘上的图跟上游没关系。
    // 顺序反过来的话，上游一挂，连已经下过的图都打不开 —— 缓存等于白建。
    const cached = readDisk(relativePath)
    if (cached !== undefined) {
      remember(relativePath, cached)
      return cached
    }

    const stampNow = now()
    if (cooldownUntil > stampNow) {
      throw new Error(`姿势图上游暂时读不到（冷却 ${Math.ceil((cooldownUntil - stampNow) / 1000)} 秒）`)
    }

    const noteFailure = (): void => {
      const at = now()
      // 距上次失败太久就不算"连续"：间断的偶发失败不该攒成"远端挂了"
      failures = at - lastFailureAt > COOLDOWN_MS ? 1 : failures + 1
      lastFailureAt = at
      if (failures >= FAIL_THRESHOLD) cooldownUntil = at + COOLDOWN_MS
    }

    let response: Response
    try {
      // **redirect: 'error'**：默认的 follow 会让"origin 固定为 https 图床"只在第一跳成立。
      // 上游一个 302 就能把它变成任意 http(s) 出口（实测能打到 127.0.0.1），
      // 还会顺带 https → http 降级。代理的每条边界都得自己钉住。
      response = await fetchImpl(`${origin}/${relativePath}`, {
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      })
    } catch (error) {
      noteFailure()
      throw error
    }
    if (!response.ok) {
      noteFailure()
      throw new Error(`姿势图暂时读不到（${response.status}）`)
    }

    // 先看声明长度：能提前拒绝就别把 9 MB 读进内存再说"太大了"
    const declared = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      noteFailure()
      throw new Error(`姿势图大小异常（声明 ${declared} 字节）`)
    }

    // 流式读并逐块累计：Content-Length 可以缺席或撒谎，上界必须靠实际字节数兜住。
    // 直接 `arrayBuffer()` 是先吃进内存再判大小，等于上界只在事后生效。
    const buffer = await (async (): Promise<Buffer> => {
      const body = response.body
      if (body === null) return Buffer.from(await response.arrayBuffer())
      const reader = body.getReader()
      const chunks: Buffer[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done === true) break
        if (value !== undefined) {
          total += value.byteLength
          if (total > MAX_BYTES) {
            await reader.cancel()
            throw new Error('姿势图大小异常')
          }
          chunks.push(Buffer.from(value))
        }
      }
      return Buffer.concat(chunks)
    })()

    if (buffer.length < MIN_BYTES) {
      noteFailure()
      throw new Error('姿势图大小异常')
    }
    const mediaType = mediaTypeOf(buffer)
    if (mediaType === undefined) throw new Error('姿势图不是 PNG/JPEG')

    // 成功一次就把失败计数清零：偶发失败不该攒成"远端挂了"
    failures = 0
    lastFailureAt = 0
    cooldownUntil = 0

    try {
      const file = diskPathOf(relativePath)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      // 先写临时文件再 rename：面板正在读的时候不会读到半个文件
      const temp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(temp, buffer)
      fs.renameSync(temp, file)
      setImmediate(pruneDisk)
    } catch {
      // 缓存写不进去（只读安装目录之类）不该让这次请求失败，图已经在手里了
    }

    return { mediaType, buffer, from: 'network' }
  }

  /** 取一张图：内存 → 单飞合并 → 磁盘 → 网络。 */
  const fetchImage = async (relativePath: string): Promise<PoseImage> => {
    const hit = memory.get(relativePath)
    if (hit !== undefined) {
      remember(relativePath, hit)
      return hit
    }
    const running = inflight.get(relativePath)
    if (running !== undefined) return running
    const task = download(relativePath).then(value => {
      remember(relativePath, value)
      return value
    }).finally(() => {
      inflight.delete(relativePath)
    })
    inflight.set(relativePath, task)
    return task
  }

  return {
    fetch: fetchImage,
    materialize: async (relativePath, dir) => {
      const image = await fetchImage(relativePath)
      const file = path.join(dir, path.basename(relativePath))
      fs.mkdirSync(dir, { recursive: true })
      // 与缓存写入同样先写临时文件再 rename：面板可能正在读同一个路径
      const temp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(temp, image.buffer)
      fs.renameSync(temp, file)
      return { file, mediaType: image.mediaType }
    },
    stats: () => {
      let diskFiles = 0
      let diskBytes = 0
      for (const sub of ['thumbs', 'img']) {
        const dir = path.join(cacheDir, sub)
        let names: string[] = []
        try {
          names = fs.readdirSync(dir)
        } catch {
          continue
        }
        for (const name of names) {
          try {
            const stat = fs.statSync(path.join(dir, name))
            if (stat.isFile()) {
              diskFiles += 1
              diskBytes += stat.size
            }
          } catch {
            // 忽略
          }
        }
      }
      return {
        memoryEntries: memory.size,
        diskFiles,
        diskBytes,
        cooldownRemainingMs: Math.max(0, cooldownUntil - now()),
      }
    },
  }
}
