/**
 * 产物登记：把一次运行收到的产物写进资产索引。
 *
 * ## 为什么要抽出来
 *
 * 原来只有「同步等到产物」那一条分支在 `index.add(...)`（`run.ts` / `rerun.ts`），
 * 异步路径（后台 `watchRun` / `sweepRun`、面板 `/run` 的 sweep）收完产物只更新了
 * 运行注册表与通知 —— 索引里没有这一行，`tags` 参数在默认模式（`runWait: async`）
 * 下等于没写。之所以一直没人发现：产图本身是好的，只是「相册按标签搜不到」。
 *
 * 抽成一处还有第二个作用：**同步与异步必须用同一份登记逻辑**。两边各写一份的话，
 * 字段（尤其 `tags`、`workflowHash`、`promptId`）迟早漂移，而漂移只表现为"某些图
 * 在相册里按工作流筛不出来"，没有报错。
 *
 * ## 依赖方向
 *
 * `AssetIndex` 的类型从组件那边 import（type-only，与 `shared/tools/types.ts` 同一先例）。
 * 反过来（组件提供实现、shared 只声明形状）会让同步分支与后台分支各写一遍登记。
 *
 * 传进来的实现是 `AssetIndex` 实例，但这里只用到 `add` —— 结构类型已经足够，
 * 测试可以传一个记录调用的假对象。
 */
import type { AssetIndex } from '../../components/panel-gallery/server/store/index.js'
import type { Artifact } from './runner.js'

/** 登记需要的身份信息。`tags` 为空数组与缺省等价（索引里统一是 `[]`）。 */
export interface RecordOptions {
  index: Pick<AssetIndex, 'add'>
  workflowId: string
  workflowHash: string
  /** 产物标签。异步路径从提交时登记的上下文里带过来。 */
  tags?: string[]
  /** 统一时间戳：同一批产物该有同一个 `createdAt`。 */
  createdAt?: string
  /** 登记失败只留痕，不算运行失败（索引是派生数据，真源是 sidecar）。 */
  warn?: (message: string) => void
}

/** 需要登记的那部分运行结果（同步与异步拿到的是同一个形状）。 */
export interface RecordableOutcome {
  promptId: string
  artifacts: readonly Artifact[]
}

/**
 * 已登记过的 `promptId + path`。
 *
 * 一次运行的产物可能被**两条路径各收一次**：同一 promptId 上并发两个 watcher
 * （本仓库每条组件 entry 是独立 bundle，`collecting` 那张单飞表也各持一份），
 * 或者「续查」与还活着的 watcher 撞在同一时刻。`collectArtifacts` 的单飞只保证
 * **不多下载** —— 两个调用方仍会各自拿到同一份 outcome、各自登记一遍，
 * 而 `AssetIndex.add` 是追加写，同一路径就会在 `assets.jsonl` 里出现两行。
 *
 * 键带 `path` 而不是只用 `promptId`：一次运行出多张时，每一张都要登记。
 */
const registered = new Set<string>()

/** 只做内存去重，上限够覆盖一轮对话的运行量；超了按插入顺序淘汰。 */
const REGISTERED_LIMIT = 500

/** 标记一次登记；已经登记过则返回 false。 */
function firstTime(key: string): boolean {
  if (registered.has(key)) return false
  registered.add(key)
  if (registered.size > REGISTERED_LIMIT) {
    const oldest = registered.values().next().value
    if (oldest !== undefined) registered.delete(oldest)
  }
  return true
}

/**
 * 把一次运行的产物登记进索引。
 *
 * 逐条 `try/catch`：某一个产物写失败不该连累其余产物 —— 它们都已经在磁盘上了，
 * 索引少一行只影响检索，不影响那张图。
 *
 * 同一个 `promptId + path` 只登记一次（见 `registered` 的说明）。
 */
export function recordArtifacts(outcome: RecordableOutcome, options: RecordOptions): void {
  const createdAt = options.createdAt ?? new Date().toISOString()
  const tags = options.tags ?? []
  for (const artifact of outcome.artifacts) {
    if (!firstTime(`${outcome.promptId}\n${artifact.path}`)) continue
    try {
      options.index.add({
        digest: artifact.digest,
        path: artifact.path,
        bytes: artifact.bytes,
        mime: artifact.mime,
        ...(artifact.width === undefined ? {} : { width: artifact.width }),
        ...(artifact.height === undefined ? {} : { height: artifact.height }),
        workflowId: options.workflowId,
        workflowHash: options.workflowHash,
        promptId: outcome.promptId,
        createdAt,
        tags,
        status: 'present',
      })
    } catch {
      try {
        options.warn?.('资产索引登记失败（产物已落盘）')
      } catch {
        // 日志自己抛错不能把"图已经出了"升级成一次运行失败
      }
    }
  }
}
