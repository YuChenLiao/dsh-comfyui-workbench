/**
 * ComfyUI 日志文件的增量读取。
 *
 * 为什么要有这一层：插件拉起的进程能把 stdout 接过来，但**外部启动**的实例（比如
 * ComfyUI Desktop 自己起的），它的输出在别人的终端里，我们拿不到 —— 而用户想看的
 * "启动进度"恰恰多半发生在这种场景。好在 ComfyUI 会把日志写进 `user/comfyui.log`，
 * 那是唯一能跨进程拿到的来源。
 *
 * 两件事要小心：
 * ① **不要读整个文件**：几百 KB 的历史读进面板既慢又没用。首次只取末尾若干行，
 *    之后从记录的偏移往下读。
 * ② **文件会被轮转**（`comfyui.log` → `comfyui.prev.log`）：大小变小或 inode 变了
 *    就当作新文件，从头开始。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 首次读多少行。够看清当前在干什么，又不至于把历史全塞进面板。 */
const TAIL_LINES = 200

/**
 * 从文件末尾取若干行。
 *
 * 按块从尾部回读，避免把整个文件载入内存。
 *
 * @param file - 日志路径。
 * @param lines - 要取的行数。
 */
export function readTail(file: string, lines: number = TAIL_LINES): string {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    if (size === 0) return ''
    const chunk = 64 * 1024
    let pos = size
    let found = 0
    // 各块先攒成 Buffer，最后一次性 decode —— 逐块 toString 会把跨块边界的
    // 多字节字符切成 U+FFFD（长中文行/长堆栈会命中）。
    const pieces: Buffer[] = []
    while (pos > 0 && found <= lines) {
      const readSize = Math.min(chunk, pos)
      pos -= readSize
      const buf = Buffer.alloc(readSize)
      fs.readSync(fd, buf, 0, readSize, pos)
      pieces.unshift(buf)
      // 找换行要在解码后的文本上数；这里为省内存只在必要时解码已读部分
      const probe = Buffer.concat(pieces).toString('utf8')
      found = (probe.match(/\n/g) ?? []).length
    }
    const out = Buffer.concat(pieces).toString('utf8')
    const all = out.split('\n')
    // 末尾若以换行结束，split 会多出一个空串
    if (all.length > 0 && all[all.length - 1] === '') all.pop()
    return all.slice(-lines).join('\n')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch { /* 忽略 */ }
    }
  }
}

/**
 * 跟踪一个日志文件，把新增内容交给回调。
 *
 * 用法上等价于 `tail -f`，但只在被问起时才读（由使用方控制节奏）。
 */
export class LogTail {
  private offset = 0
  private lastSize = -1
  /** 上次看到的 inode。轮转后文件会被换成新的，只比大小会漏（新文件可能比旧 offset 大）。 */
  private lastIno = -1
  private started = false

  constructor(private readonly file: string) {}

  /** 当前跟踪的路径（诊断用）。 */
  get path(): string {
    return this.file
  }

  /**
   * 读一次增量。
   *
   * 第一次调用给末尾若干行（让面板立刻有内容），之后只给新增部分。
   * 文件不存在时返回空串，不报错 —— 服务没起来时这是常态。
   *
   * @returns 新增文本；没有新增则空串。
   */
  poll(): string {
    let stat: fs.Stats
    try {
      stat = fs.statSync(this.file)
    } catch {
      // 文件消失（轮转或删了）：下次出现时按新文件处理
      this.started = false
      this.offset = 0
      this.lastSize = -1
      this.lastIno = -1
      return ''
    }

    // 被轮转或截断时当作新文件。两个判据都要：
    // ① 变小 —— 截断或写到了更小的新文件；
    // ② inode 变了 —— 轮转后新文件可能比旧 offset 还大，只比大小会漏掉，
    //    之后 `size <= offset` 一直成立，日志从此静默卡住。
    //    （Windows 上某些文件系统 ino 恒为 0，那种情况退回只比大小。）
    const rotated = this.started && (
      stat.size < this.lastSize
      || (this.lastIno > 0 && stat.ino > 0 && stat.ino !== this.lastIno)
    )
    if (rotated) {
      this.started = false
      this.offset = 0
    }
    this.lastSize = stat.size
    if (stat.ino > 0) this.lastIno = stat.ino

    if (!this.started) {
      this.started = true
      this.offset = 0
      const tail = readTail(this.file)
      this.offset = stat.size
      return tail === '' ? '' : `${tail}\n`
    }

    if (stat.size <= this.offset) return ''

    let fd: number | undefined
    try {
      fd = fs.openSync(this.file, 'r')
      const length = stat.size - this.offset
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, this.offset)
      this.offset = stat.size
      return buf.toString('utf8')
    } catch {
      return ''
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd) } catch { /* 忽略 */ }
      }
    }
  }

  /** 探测 ComfyUI 安装目录下的日志文件路径；找不到返回 undefined。 */
  static locate(installDir: string | undefined): string | undefined {
    if (installDir === undefined || installDir === '') return undefined
    const candidate = path.join(installDir, 'user', 'comfyui.log')
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // 忽略
    }
    return undefined
  }
}
