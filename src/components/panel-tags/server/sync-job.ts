/**
 * 「更新标签」的后台任务。
 *
 * 一次更新 = 4 个 CSV（约 9 MB、十几秒）+ 91 个 wiki 分组页（约 2.5 分钟）。
 * 两分多钟的活不能同步等在一个 HTTP 请求里，所以拆成：
 * `POST /tags/sync` 立即返回 job 状态，`GET /tags/sync` 轮询进度。
 *
 * **单例**：同一刻只允许一个任务，重复点击直接返回正在跑的那个 —— 两个任务同时
 * 往同一批文件写盘会互相踩。
 */
import { importUpstream, UPSTREAM_FILES } from '../../tool-danbooru/server/upstream.js'
import type { UpstreamResult } from '../../tool-danbooru/server/upstream.js'
import { syncGroups } from '../../tool-danbooru/server/groups.js'
import type { GroupsResult } from '../../tool-danbooru/server/groups.js'
import { TAG_KINDS } from '../../tool-danbooru/server/store.js'

/** 任务状态。 */
export interface SyncJobState {
  state: 'idle' | 'running' | 'done' | 'failed'
  /** 当前阶段（人话，直接给面板显示）。 */
  stage: string
  /** 本阶段的进度。 */
  done: number
  total: number
  /** 失败时的说明。 */
  message: string
  /** 开始 / 结束时间戳。 */
  startedAt: number
  finishedAt: number
  /** 最后一次成功的时间（面板显示「上次更新」）。 */
  lastSuccessAt: number
  /** 各类导入了多少条。 */
  results: Array<{ kind: string; records: number; withNames: number }>
  /** 分组结果。 */
  groups: { groups: number; tags: number; failed: string[]; fromCache: boolean } | null
}

/** 空状态。 */
function idle(): SyncJobState {
  return {
    state: 'idle',
    stage: '',
    done: 0,
    total: 0,
    message: '',
    startedAt: 0,
    finishedAt: 0,
    lastSuccessAt: 0,
    results: [],
    groups: null,
  }
}

/** 后台任务控制器。 */
export interface SyncJob {
  /** 开始一次更新；正在跑就返回当前状态。 */
  start: () => SyncJobState
  /** 查当前状态。 */
  status: () => SyncJobState
}

/**
 * 建一个后台任务控制器。
 *
 * @param options.dataDir - 插件数据目录（写这里，不碰随包数据）。
 * @param options.onSettled - 任务结束时回调（面板用来让索引失效）。
 */
export function createSyncJob(options: {
  dataDir: string
  onSettled?: () => void
  /** 注入给测试：替换掉真实的网络实现。 */
  runCsv?: (kind: string, log: (message: string) => void) => Promise<UpstreamResult>
  runGroups?: (log: (message: string) => void) => Promise<GroupsResult>
}): SyncJob {
  let current = idle()

  const runCsv = options.runCsv ?? ((kind, log) =>
    importUpstream(kind as (typeof TAG_KINDS)[number], { dataDir: options.dataDir, log }))
  const runGroups = options.runGroups ?? (log => syncGroups({ dataDir: options.dataDir, log }))

  const start = (): SyncJobState => {
    if (current.state === 'running') return current

    current = { ...idle(), state: 'running', stage: '准备中…', startedAt: Date.now() }

    // 故意不 await：HTTP 里立刻返回，进度靠 status() 轮
    void (async () => {
      const results: SyncJobState['results'] = []
      try {
        for (const [index, kind] of TAG_KINDS.entries()) {
          current = {
            ...current,
            stage: `下载 ${UPSTREAM_FILES[kind]}`,
            // `done` 是"已完成几个"，不是"正在下第几个"——用 index 的话四类永远到不了 4/4
            done: index,
            total: TAG_KINDS.length,
          }
          const result = await runCsv(kind, message => {
            current = { ...current, stage: message }
          })
          results.push({ kind, records: result.records, withNames: result.withNames })
          current = { ...current, done: index + 1 }
        }

        // 分组阶段的进度只存在于 `syncGroups` 的日志文本里（「抓取 20/91」），
        // 拿不到结构化的 done/total。**这里把 total 置 0**，面板就不会再拼一个
        // 恒为 0/N 的假进度；真实进度交给 stage 那句话。
        current = { ...current, stage: '抓取语义分组（wiki）', done: 0, total: 0 }
        const groups = await runGroups(message => {
          current = { ...current, stage: message }
        })

        const failed = groups.failed
        // 全部失败 = 一个文件都没写（`syncGroups` 保留旧快照）。那就不能记"最后成功时间"，
        // 否则面板一边说失败一边说"刚更新过"，而磁盘上什么都没变。
        if (groups.fromCache) {
          current = {
            ...current,
            state: 'failed',
            stage: '分组抓取全部失败',
            message: '分组页面一个都没抓到，已保留旧快照 —— 数据没有任何变化。',
            finishedAt: Date.now(),
            results,
            groups: { groups: groups.groups, tags: groups.tags, failed, fromCache: true },
          }
        } else {
          current = {
            ...current,
            state: failed.length === 0 ? 'done' : 'failed',
            stage: failed.length === 0 ? '完成' : '分组有页面抓取失败（已用旧快照补回）',
            message: failed.length === 0 ? '' : `这些组没抓到：${failed.join(' / ')}`,
            finishedAt: Date.now(),
            lastSuccessAt: Date.now(),
            results,
            groups: { groups: groups.groups, tags: groups.tags, failed, fromCache: false },
          }
        }
      } catch (error) {
        // CSV 是一个个独立提交的：第 3 个抛错时前 2 个已经落盘了。
        // 这时说"更新失败"是误导——数据已经**半新半旧**，得把做完了哪些讲清楚。
        const done = results.map(item => `${item.kind} ${item.records}`).join(' / ')
        current = {
          ...current,
          state: 'failed',
          stage: '失败',
          message: `${error instanceof Error ? error.message : String(error)}`
            + (done === '' ? '（一个文件都没写）' : `（已写入：${done}；其余仍是旧数据）`),
          finishedAt: Date.now(),
          results,
        }
      } finally {
        // 无论成败都让索引失效：失败前可能已经写完了一两个 CSV
        options.onSettled?.()
      }
    })()

    return current
  }

  return { start, status: () => current }
}
