/**
 * ComfyUI 子进程的输出缓冲。
 *
 * 面板要展示的是"终端里正在滚什么"，所以这里按行存、有上限、带单调序号：
 * 前端带上自己的 cursor 来拉增量，不需要每次重传整屏。
 *
 * 另外带一个 `epoch`：缓冲实例的唯一代号。插件热重载会重建这个对象、序号从 1 重来，
 * 而浏览器还攥着旧的高位 cursor —— 只看序号无法区分"没有新行"和"换了个缓冲"。
 */

/** 一行输出。 */
export interface TerminalLine {
  /** 单调递增，前端用它做增量拉取。 */
  seq: number
  /** 来自 stdout 还是 stderr。 */
  stream: 'out' | 'err'
  /** 已剥掉 ANSI、已处理行内回车的文本。 */
  text: string
  /** 入缓冲的时间戳（毫秒）。 */
  at: number
}

/** 一次拉取的结果。 */
export interface TerminalSlice {
  lines: TerminalLine[]
  /** 下次拉取应当带的 cursor。 */
  cursor: number
  /** 因为超出上限被丢掉的累计行数（前端据此提示"更早的被截断"）。 */
  dropped: number
  /** 缓冲实例代号：变了就说明被重建，前端的 cursor 不再可信。 */
  epoch: string
}

/** 默认保留多少行。启动日志几百行，留到 2000 足够翻查又不至于吃内存。 */
const DEFAULT_CAPACITY = 2000

/** eslint-disable-next-line no-control-regex */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\u001b[()][A-Z0-9]/g

/** 剥掉 ANSI 转义序列（颜色、光标控制、OSC 标题等）。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/**
 * 把一段原始输出切成"终端里看得见的行"。
 *
 * 两件事必须按顺序做，顺序错了就出错：
 * ① 先剥 ANSI —— 进度条帧常长成 `\r\u001b[32m10%\u001b[0m`，转义码夹在回车两边，
 *    带着它们判 `\r` 会把整串帧拼成一行；
 * ② 行尾的回车是 CRLF 前半，不属于"回到行首重写"，摘掉它再找最后一个回车。
 *    否则 `"\r 10%\r 50%\r100%\r\n"`（Windows 上 tqdm 的真实形态）会拼成 `" 10% 50%100%"`。
 *
 * @param raw - 原始片段（可能含多行）。
 * @returns 剥净后的行文本；空字符串元素表示这里确实有一行空行。
 */
export function splitLines(raw: string): string[] {
  const out: string[] = []
  for (const piece of raw.split('\n')) {
    const clean = stripAnsi(piece)
    const body = clean.endsWith('\r') ? clean.slice(0, -1) : clean
    const at = body.lastIndexOf('\r')
    out.push(at >= 0 ? body.slice(at + 1) : body)
  }
  return out
}

/**
 * 有界的终端输出缓冲。
 *
 * 之所以不用数组 shift：日志多时 shift 是 O(n)。用环形数组按容量覆盖，代价固定。
 */
export class TerminalBuffer {
  private readonly capacity: number
  private buf: TerminalLine[] = []
  /** 写入位置（覆盖式）。 */
  private head = 0
  private nextSeq = 1
  private droppedCount = 0
  /** 本实例的唯一代号（热重载会换一个）。 */
  readonly epoch: string = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity))
  }

  /** 追加一段原始输出（自动切行、剥 ANSI、处理回车重写）。 */
  push(stream: 'out' | 'err', raw: string): void {
    const parts = splitLines(raw)
    // 最后一段是"还没换行"的残段时（chunk 边界落在行中间），照样记一行 ——
    // 宁可多一条碎片，也不要等到下一次 chunk 才显示。
    for (let i = 0; i < parts.length; i += 1) {
      const text = parts[i] as string
      // 末尾那一段是空串时跳过：`"a\n"` split 出来是 ['a','']，'' 不是真的空行。
      if (i === parts.length - 1 && text === '') continue
      const line: TerminalLine = { seq: this.nextSeq, stream, text, at: Date.now() }
      this.nextSeq += 1
      if (this.buf.length < this.capacity) {
        this.buf.push(line)
      } else {
        this.buf[this.head] = line
        this.head = (this.head + 1) % this.capacity
        this.droppedCount += 1
      }
    }
  }

  /** 按 cursor 取增量。cursor 为 0 表示要当前全部（受容量限制）。 */
  since(cursor: number): TerminalSlice {
    const ordered = this.ordered()
    const lines = cursor <= 0 ? ordered : ordered.filter(line => line.seq > cursor)
    const last = ordered.length === 0 ? this.nextSeq - 1 : (ordered[ordered.length - 1] as TerminalLine).seq
    // 回的是「实际给到哪一行」，不是「调用方原来带的数」。曾经写成 Math.max(cursor, last)：
    // 缓冲重建后（epoch 变了）浏览器还拿着旧高位，之后每轮都判成"没有新行"，面板永久失明。
    return {
      lines,
      cursor: last,
      dropped: this.droppedCount,
      epoch: this.epoch,
    }
  }

  /** 当前行数。 */
  size(): number {
    return this.buf.length
  }

  /** 清空（cursor 不回退：前端拿着旧 cursor 来也不会看到重复内容）。 */
  clear(): void {
    // 不把可见行计入 dropped：那是用户自己按的清屏，不该弹「更早的 N 行已滚出缓冲」。
    this.droppedCount = 0
    this.buf = []
    this.head = 0
  }

  /** 按写入顺序取出（环形数组被覆盖后 head 是最旧位置）。 */
  private ordered(): TerminalLine[] {
    if (this.buf.length < this.capacity) return [...this.buf]
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)]
  }
}
