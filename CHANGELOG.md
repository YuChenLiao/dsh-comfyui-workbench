# CHANGELOG

## 未发布

### 新增

- **面板上能直接开关「精确进度」**：`progressStream` 原来只能改 profile 的 `cordis.patch.yml` 或设环境变量，改完还得重启 DSH。现在「工作流管理」面板里有一个开关，写的是插件数据目录的 `settings.json`（`~/.dsh-comfyui-workbench/settings.json`），**下一次提交就生效**。

  优先级是「面板开关 > 配置 / 环境变量 > 内置默认」：配置文件仍然是"默认值"，用户点了开关就以开关为准；POST 传 `null` 能清掉覆盖、退回配置。`/config` 的响应里带 `toggles.progressStreamSource`（`toggle` / `config`），面板据此标一句"当前值来自配置文件"。

  两个实现要点：`/config` 加进了 dispatch 的 `selfManaged` —— 它是「GET 读配置 / POST 写开关」的同一路径，塞进 `WRITABLE` 会把 GET 也一起拦成 405（`/terminal` 与 `/rerun` 都踩过这个坑），同时 handler 自己挡掉 PUT/DELETE，别让它们落到"当 GET 处理"上返回 200；开关**故意不缓存** —— `toggles.ts` 会被两条 entry 各内联一份（`/config` 在 `lib/index.js`、`/run` 在 `lib/entries/workflow.js`），模块级缓存跨 bundle 不共享，面板写入只会失效自己那份，于是「面板显示已开、下一次运行却没有进度」。文件只有几十字节，`/run` 本来就在读工作流文件，直接读盘最省心。这一点是本仓第三次撞「模块级状态跨 bundle 分裂」，`RunRegistry` 与 `collecting` 都栽过。

- **`comfyui_runs`：查任务运行状态**（第 10 个工具）。补的是「提交之后那几分钟」的空白 —— 出图实测中位 115 秒、最长 336 秒，这段时间里模型不知道在跑、排队第几、卡住了还是死了，只有完成时的一条通知。

  运行表挂在 runtime 上（不是模块级：多个 entry 各一份 bundle，模块级会分裂），落盘 `<会话>/comfyui_output/runs.json`，最多 200 条。**重启后原来 queued/running 的标成 `unknown` + `stale`** —— 那些任务在 ComfyUI 侧可能早完成了，但我们已经无从得知，留在 `running` 会让人一直等一个永不变化的状态。

  排序用单调递增的 `seq` 而不是时间戳：批量提交的几条会挤在同一毫秒，"最近的在最前"靠时间戳会失效。

### 修复

- **`wait: true` 与「无 agent」的提交路径不收敛终态**：watcher 本来是唯一的状态更新来源，而它只在「异步 + 有会话」时挂。那两条路径的记录会永久停在 `queued`，`comfyui_runs` 对早就出完的图一直答"还在跑"，`activeCount` 虚高，僵尸记录还会挤占上限、把真正在跑的那条挤掉。补了 `sweepRun()`：自查 `checkRun` 收敛到 done / 超时 unknown / 异常 failed，不投递消息只更新注册表。
- **`sweepRun` 缺守卫会误标**：history 比轮询慢时同一 promptId 被并发处理，序列可能变成 `done → failed`（图已落盘却记成失败）；一次瞬时的 `ECONNREFUSED` 也会永久判死。加了 `inflight`/`settled`，并把 catch 分级 —— `execution_failed` 立即判失败，网络类错误累计 6 次才判。
- **`trim()` 会删掉正在跑的记录**：原来只按 seq 淘汰，200 条都在跑时新提交一条会删掉最老的 `running`，面板上那条正在跑的任务凭空消失。改成终态优先。
- **`sweepRun` 的日志会崩宿主**：catch 里 `logger.warn` 没包 try，它自己抛错就逃逸成 unhandledRejection（Node 默认结束进程）。与 `deliver()` 同一个理由，补上。
- **`no_output` 的文案把 validate 失败说成"末端缺输出节点"**：真机上给一个工作流传 `sampler_name: 'no_such_sampler_xyz'`，ComfyUI 的 validate 只拒掉那一条输出链、别的链照常跑完 —— `/history` 里仍是 `status_str: success` + `completed: true`，`outputs` 有内容（文本节点）但没有一个 `filename`。插件据此落 `no_output`，文案却让人"检查末端是否有 SaveImage / PreviewImage 节点"；而那个工作流有 SaveImage，真实原因是参数名拼错，`failure-kind.ts` 里 `bad_param` 的判据（含 `value not in list`）在这条路径上根本不可达。

  对照 ComfyUI 源码（`execution.py:1187-1194`、`:1232-1300`、`server.py:1234-1238`）重写成两种**成立**的成因：① 后端没回传任何带 `filename` 的产物引用（末端只连纯文本/纯数据节点最常见，自定义节点不回报 filename 也落这里）；② 原本写文件的那条链被 validate 拒、**且**剩下能跑完的链都不写文件（只有那条链被拒、别的链仍在写文件时产物照样有，走不到这里）。同时写明不能再说"缺输出节点"：一个 `OUTPUT_NODE` 都没有的模板在提交阶段就被 `prompt_no_outputs` 拒，全部链被拒则回 400 `prompt_outputs_failed_validation` —— 两条都走 `submit_rejected`，到不了 `no_output`。

  同源的另一处 `submitRejected`：原来一律说"检查被点名的节点参数"，而 `prompt_no_outputs` 的 body 里 `node_errors` 是**空对象**（`execution.py:1188-1194` 的 error 不带节点信息，`server.py:1238` 原样回传），那句话点不到任何东西。现在按 `body.error.type` 分三支：`prompt_no_outputs` 指向"没有输出节点"、`prompt_outputs_failed_validation` 指向"所有链参数都被判非法"，其余保持原文案（反代把 `error` 压成字符串时安全退回）。

  顺带删掉 `noOutput()` 的 `hintTerminal` 参数：全仓唯一调用点硬编码 `true`，false 那条措辞永远不会显示给任何人。`infer.ts` 的 notes（改成留退路的写法：插件按类名推断，自定义输出节点可能被漏判）、`failure-kind.ts` 关于 `bad_param` 的注释、`docs/design.md` 的三处同族措辞（错误表 `no_output` 与 `submit_rejected`、§7 边界表、B14 验收项）一并订正。

  **仍然缺的一环**：`POST /prompt` 的 200 响应里本来就带 `node_errors`（`server.py:1234`，部分链失败时也会返回），而 `client.ts` 只取 `prompt_id` 把它扔了。收下它就能在提交当场说出"节点 6 的 sampler_name 不在候选里"，不必等几秒后从"没有产物"倒推。

- **`sweepRun` 从不查 `/queue`，面板提交的记录没有 `running` 态与 `queuePosition`**：`watchRun`（工具提交、有会话通道）每 tick 先查队列写状态，`sweepRun`（面板 `/run`，以及无会话通道时的 `comfyui_run` / `comfyui_run_batch` / `comfyui_rerun`）完全没有这一段 —— 真机实测一次 11 秒的运行从头到尾只有 `queued → done`。面板上看不出「正在跑」和「排队中」的区别，而 `comfyui_runs` 的描述写着「queued 是排队中的（带 queuePosition）」，对面板提交的记录不成立。

  修法是把那段抽成 `syncQueueState(client, promptId, registry)` 给两个轮询者共用；两处 `registry` 的内联类型合并成 `QueueRegistry`（不 import `RunRegistry` —— `shared/run` 与 `shared/tools` 互不允许依赖，`tests/arch.mjs` 双向检查）。

  真机复验：`queued` → **`running`（`queuePosition=0`、`startedAt` 有值）** → `done`。

  两个已知边界（未修，都不改变终态）：`client.ts` 的 `queue()` 没有 single-flight，缓存是在 `await fetch` **之后**才赋值，批量 20 条同时进入首个 tick 时最多 20 路并发穿透（上界；实际因逐条 `await submitWorkflow` 后才挂 sweep，挂载时刻天然错开。稳态仍是 1 次/秒 —— 缓存是 client 实例级）；`syncQueueState` 放在 `checkRun` 之前，而 `queue` 的请求超时默认 120 秒（`COMFYUI_TIMEOUT_MS` 可配，最大 1 小时），ComfyUI 卡死时完成发现可能被推迟该次超时的时长。

- **`/run` 与 `/rerun` 的 `timeoutMs` 是死参数**：接口认真校验 1s~1h、`submitAndTrack` 认真往下传，而 `submitWorkflow` **一次都没读过 `RunOptions.timeoutMs`** —— 声明了、校验了、然后被丢掉。现在它只做一件事：**放宽**后台盯守时长（`maxWaitMs = max(30min, timeoutMs)`，见 `sweepBudgetOf`），并把实际生效的预算写进返回的 `notes`。传 60000 会被抬到 30 分钟（出图实测中位 115 秒、最长 336 秒，按 120s/300s 收紧会把真在跑的任务标 `unknown`），传 1 小时照用。

  这条接线原先不可测：纯函数用例删掉调用照样全绿。现在 `note` 读的就是传给 `sweepRun` 的**同一个对象**，摘掉 `maxWaitMs` 字段 note 会变 0 分钟，route 级用例立刻变红。

- **`resumeRun` 与 `sweepRun` 会把同一产物收两份**：面板按 promptId 轮询与后台兜底会同时（或先后）处理同一个 promptId。`targetFor` 用 `fs.existsSync` 判冲突 —— 都判"没冲突"就写同名（内容相同、无害），后一个判"有冲突"就落一份带时间戳前缀的副本，用户看到两张一样的图。

  更常见的是**顺序**的第二次：`forgetRun` 已把上下文清掉，跨 bundle 时 `recallRun` 恒空，那份副本的 sidecar 里 `workflowId` 会是 `"unknown"` —— 面板上点"作为输入出图"直接报 `no-workflow`，成为死链资产。

  判据因此落在**磁盘**上（比对 sidecar 里的 `comfy.promptId`），而不是模块级 Map：本仓库每条组件 entry 都是独立 bundle，模块级状态跨 bundle 不共享（`runtime.ts` 记过这个坑）。内存里那张 in-flight 表只作为同一 bundle 内的快速路径。

- **`progressStream` 在真机上不可能工作**：`progress` 事件带 sid 发出（`main.py:475`），而 `watchProgress` 自己造了个随机 `clientId` 去连 `/ws` —— 握手成功、`status` 能收，但**永远收不到本任务的进度**。真机实测：20 步跑完，相关事件 0 条。现在复用 `ComfyClient.clientId`（提交时用的那个），并新增 `Settings.progressStream`（默认关，`COMFYUI_PROGRESS_WS=1` 可开）。

  两条真机事实（对照本机 ComfyUI 源码核实）：`server.client_id` 是在**开始执行**时由 `extra_data["client_id"]` 赋值的（`execution.py:740`），所以它指的是"本任务的提交方"而不是"最后提交的那个"；但 `server.py:341-345` 同 sid 再连会 `sockets.pop(sid)`（旧连接不 close、只是不再收消息），所以**同一个 `client_id` 只能有一条活着的订阅**，并发两条运行时先建的那条会静默没有百分比。

  只接了面板路径（`/run`、`/rerun`）；工具侧没接 —— `ToolDeps` 里没有 `settings`，扩它要动 11 个工具的依赖面。

- **`comfyui_rerun`：从产物重跑 / 做变体**（第 11 个工具）。出图后最常见的下一步是"再来一张"或"这张构图好但细节差，调一点重跑"，而 sidecar 里已经躺着复现材料（`workflowId` / `workflowHash` / `vars` / `seed`），原来只能手工抄参数。

  三种 seed 策略：给数字就用它（`count>1` 依次 +1）、`'random'` 每张独立、不给就沿用原值递增。**sidecar 没记 seed 时出多张会各自随机** —— 否则三张是同一张的复制，"做变体"就失去意义。

  **seed 槽位名不硬编码**：从 IO 面找 `seed` 或 `noise_seed`，找不到就完全不注入。硬写 `vars.seed` 会让 `applyVariables` 抛 `variable_unknown` —— 本仓库自己的 `infer` 就把 `noise_seed` 当一等命名，这条踩过。

  工作流被改过（`workflowHash` 不同）时**提示但不阻止**：改内部参数不影响表面，`vars` 的键名可能仍兼容。

### 改进

- **执行失败分五类，建议按类给**。原来无论什么错都是同一句"通常是模型/节点参数不匹配或显存不足"。而真实失败就那么几类，解法完全不同：OOM 要降分辨率、缺模型要去装或换、输入图坏了要查文件、参数越界要改值。模型拿笼统句子只能猜，猜错就是又一轮报错。

  分类器是纯函数（`oom` / `missing_model` / `missing_node` / `bad_input` / `bad_param` / `unknown`），认不出就退化成原来那句。`code` 仍是 `execution_failed`（调用方可能按它分支），新增 `kind` 字段。

- **判据的二维性**：`isRetryable`（还等不等）与 `finalStateOf`（终态写什么）是**两件事**，不能合成一个布尔。典型分叉是 `no_output`（执行完成了但没拿到产物文件）：它还值得继续等 —— ComfyUI 写 outputs 与 SaveImage 落盘之间有竞态窗；但真的放弃时终态必须是 `failed`，"完成了但没产物"是个确定结论，写 unknown 会让人一直等。

  这个坑踩了两次：第一次是手写判据把 `no_output` 当"可重试的网络问题"，三条路径一起说"连续 6 次查不到 /history"（事实完全相反）；第二次是把判据换成 `isRetryable`，二维又压回一维，wait 路径照样把它降级成 pending，让用户去续查一个永远查不到的结果。

- **瞬时失败不再一次判死**：`/history` 报 5xx 在 ComfyUI 重启窗口里是常态，而 `watchRun` 原来一个 tick 就判死并发"执行失败"通知 —— 更糟的是判死后 `collectArtifacts` 永不执行，**图其实出了也不落盘**。现在只有 `execution_failed` / `auth_failed` 立即判死，网络类连续 6 次才标 unknown，文案改成"查不到 /history，用 promptId 续查"而不是"执行失败"。同一份 `client.history()` 的两个消费者（watchRun / sweepRun）现在用同一套判据。

- **`/history` 的 5xx 不再被当成"还没完成"**：原来 `if (!res.ok) return undefined`，于是 poller 永远认为任务在跑 —— 记录停在 queued、`activeCount` 虚高，而 ComfyUI 可能早挂了。现在 404 仍表示"记录还没有"，401/403 抛认证错误，其它非 2xx 抛可重试错误（文案说清是"查询失败"而不是"连不上"）。

  几个实测抓出来的坑：
  - **`Value not in list` 不能一律当缺模型**。`'add-detail-xl.safetensorsx' not in ['add-detail-xl.safetensors']` 是值写错了，候选里本来就有对的。现在归 `bad_param` 并点名"你写的是 X，候选里是 Y"。
  - **抓文件名要抓被拒绝的那个**。按扩展名找第一个匹配会落到候选列表里那个正确的名字，等于把"你拼错了"说成"你缺这个文件"。
  - 补了中文模式（自定义节点会抛中文）与 OOM / 缺节点的其它说法（`Errno 12 Cannot allocate memory`、`OOM when allocating tensor`、`The following node types were not found`、`Node 'X' not found`）。

### 新增

- **`comfyui_workflow_list` 可以按输入类型筛**：`inputs: 'image'` 只返回需要图片输入的工作流，并在结果里给出 `imageSlots`（该往哪个键里传图）与 `needsImage`。模型想"拿这张图去出图"时不必自己翻每个工作流的 `inputKinds` 再猜槽位名。

  配合 `comfyui_run` 的 `vars` 就通了：筛出工作流 → 把图路径传给对应槽位（`LoadImage` 只认 ComfyUI `input/` 目录里的文件名，插件会自动搬运本地图）。

  面板侧的"从资产库选图"入口尚未做 —— 那只是人类入口，模型这条链已经通了。

- **以产物当时的参数重跑（图作为输入）**：产物卡片上多一个按钮 —— 读 sidecar 里的 `workflowId` 与 `vars` **原样重跑，只把图片输入换成这张**。

  第一版做错了两处，都源于同一个误解：以为是"把图喂给某个工作流"，实际用户要的是"这张图当时怎么生成的，照那个再来一遍"。所以第一版让用户挑一个吃图的工作流、只传图路径，prompt / seed / 步数 / 模型全走默认值 —— 等于把原图的一半信息丢了。

  现在工作流由 sidecar 决定，不需要用户挑（那套浮层已删）。不传 `asInput` 就是普通重跑（参数全保留、不换图）；工作流不吃图会明确拒绝，不静默降级成空参数重跑。

  两个已知取舍：多个 image 槽位只换第一个（其余仍走 sidecar 原值）；普通重跑时 `image` 是 sidecar 里记的 ComfyUI 内文件名，依赖那份文件还在 ComfyUI 的 input 目录 —— 被删了会明确报错，不会静默跑空。

  面板走的是 HTTP 路由，与工具侧**是两份 `toListItem`** —— 第一版只改了工具侧那份，于是 `?inputs=image` 完全无效（形参还叫 `_url`，从不读 query），面板永远弹"本机没有需要图片输入的工作流"，静默失败还给出误导性提示。

  另外两处契约也只对了一半：`POST /run` 只认扁平的 `workflowId`（发 `{workflow:{id}}` 直接 400），而 `/run` 失败时返回 **200 + `ok:false`**（只看 `res.ok` 会把失败弹成"已提交"）。

- **精确进度（可选，默认关）**：`sweepRun` 新增 `progressStream`，从 ComfyUI 的 `/ws` 读 `progress` 事件，写进运行记录的 `progress: {value, max}`。轮询只能答"在跑吗、排队第几"，答不了"画到 37% 了"。

  **默认关闭，且未经真机验证**：本机 ComfyUI 离线（8188 无监听），这条路径只在注入假 WebSocket 下验过正向与降级。连不上时静默降级，出图不受影响。

  **目前没有任何生产调用方传它** —— `Settings` 里没有开关，`/run`、`run_batch`、`rerun` 都没接。只有测试或直接调用模块能开。

  已知局限：断线不重连（百分比会冻结在最后一次，看起来像卡住）；`max` 按采样节点重置会回跳；没有采样器的工作流（纯 upscale / VAE）全程无百分比；Node 20 没有全局 `WebSocket`，那时会静默不生效；有 basic auth / API key 的实例连不上；一条运行一条长连接，batch 20 就是 20 条。

  另外两处实现细节后来才补：`watchRun` 曾声明过 `progressStream` 却一次都没用（假契约，已删）；`stopAllWatchers` 原先只清 timer 不清进度连接，热重载后会残留 socket。

### 优化

- **批量提交只投递一条汇总通知**：`run_batch` 原来逐条挂 watcher，10 张图 = 10 次 `followup` = **10 轮对话打断** —— 一件本来可以一次说完的事被拆成十次汇报。

  **没有改用 `inject`（不唤醒）**：模型不知道出图效果就没法继续迭代，「这张脸崩了换 seed 再来」这类对话根本进行不下去。所以保留唤醒、改**频次**：一批结束投一条，含每条产物的路径与尺寸。

  踩了一个反直觉的坑：收尾处加「兜底 flush」看着稳妥，实际在异步路径上**必然先于任何 watcher 执行**，于是投出「本批 3 条全部结束（0 成功，0 失败），用时 0 秒」，而 `delivered` 标记把所有真实结果全挡掉 —— 比改动前的逐条推送更糟。兜底不能抢在真结果前面。

- **`run_batch` 按工作流分组后提交**：ComfyUI 的权重按"上次用的那份"常驻显存，同工作流连续跑只换 seed 不重载，但 `SDXL → Flux → SDXL` 来回切每次都要重载几十秒。改成提交前按工作流声明分组；`results` 仍按原始下标返回，调用方靠 `index` 对账不会错位。
- **`/queue` 加 1 秒缓存**：批量 20 条任务各自轮询，不缓存的话同一秒会打出 20 次请求。

## 0.4.0

### 新增

- **终端面板**（`panel.terminal`，可单独开关）：第三个面板，展示 ComfyUI 的命令行输出。想知道服务在干什么、卡在哪一步、模型加载到几成，这些只在终端里。

  **前提是把输出接上**：`ComfySupervisor` 此前用 `stdio: 'ignore'` 拉起子进程，ComfyUI 的输出被直接丢弃。现在改成 pipe，配一个 2000 行的环形缓冲挂在 runtime 上（组件可能还没加载，进程就已经在拉了）。缓冲带单调序号，前端按 cursor 拉增量，不重复下载整屏。

  **两个容易被忽略的细节**：ANSI 转义必须在入库前剥掉 —— ComfyUI 的进度条用 `\r` 加颜色码反复刷新同一行，原样送到浏览器是一屏乱码；子进程强制 `PYTHONIOENCODING=utf-8`，Windows 上不指定的话 Python 按控制台代码页输出（GBK），中文日志全是豆腐块。解码用 `TextDecoder` 的流式模式，进程退出时多字节字符被截在半个字符上也能拼回来。

  **面板能自己拉起服务**：只展示不启动的话，「打开终端看进度」必须先回对话生成一张图才会触发拉起 —— 那正是用户想避免的被动等待。面板上没有 `external` 实例时给出「启动」按钮。

  **外部实例也能看**：插件拉起的进程直接接 stdout / stderr；外部启动的实例（Desktop 自己起的那些）拿不到 stdout，改读它写的 `user/comfyui.log` —— 新增的 `LogTail` 首次给末尾 200 行、之后按偏移读增量、文件轮转则重来。两条路只走一条：ComfyUI 的 logger 同时挂 Stream 与 File 两个 handler，两边都读是每行两份。`installDirOf` 改成惰性探测（带负缓存，否则每 2 秒扫一次盘）—— 它原本只在 `start()` 里赋值，而外部实例根本走不到那里，日志就永远读不到。

  面板按状态分支说明（未启动 / 外部实例 / 启动失败带原因 / 正在读日志），而不是留一片空白让人以为是 bug。

  UI 上做了自动跟随底部（用户往上翻时不拽回来）、暂停、关键字过滤、清屏、丢弃行提示。

- **资产库可以一键隐藏 NSFW**：刷新按钮右侧一个省略号，悬浮展开。判定是启发式词表，不是分类器。

  强信号（`nsfw` / `explicit` / `hentai` / 性器官 / 中文「完全裸露」「完整裸露」「赤裸」「全裸」等）单命中即判；中信号（`nude` / `breast` / `lingerie` / 「裸露」「乳房」等）要凑够两个才算 —— 动漫 tag 里 `breasts`+`nipples` 是泳装与解剖图的标配，单命中必然误伤。

  三条约束都是被真数据打回来的：**存词根不存复数**（子串匹配，存 `breasts` 就漏 `breast`）；**不用下划线做边界**（tag 里 `lewd` 与 `lewd_pose` 都有）；**负向提示词不参与判定**（Danbooru 系底模的官方负向模板里就写着 `nsfw`，拿它判定会让一整库图全被藏，而那正是在排除成人内容）。在 363 张真实语料上校准过：「裸露」原本是强信号，会误伤 4 张 SFW 水彩插画（触发词「肩头裸露」），降为中信号后翻转恰好那 4 张。

### 修复

- **清屏接口恒 405**：`POST /terminal` 没进 `WRITABLE` 白名单，而前端不检查响应码 —— 界面清空了、下一秒整屏回填，看起来像灵异现象。同时前端现在看状态码，失败就不动本地状态。
- **cursor 超前会永久失明**：`since()` 原本回 `Math.max(cursor, last)`。插件热重载后缓冲重建、seq 从 1 开始，浏览器还拿着旧的高位 cursor，于是之后每轮都判成「没有新行」，面板死在原地；而唯一的自救手段（清屏）正好是坏的。改成回「实际给到哪一行」。
- **清屏会弹「更早的 N 行已滚出缓冲」**：可见行被计进了 `dropped`，而那是用户自己按的。
- **`/config` 只在工作流组件里注册**：关掉工作流后它 404，前端 catch 退化成「全开」—— 被关掉的页签照样显示，「独立开关」在组合场景下失效。挪到 core entry。
- **CRLF 收尾的进度条被拼成一行**：Windows 上 tqdm 的帧以 `\r` 开头、整行以 `\r\n` 收尾，
  先判「末尾是不是回车」就会整段保留，几十帧拼成一行。改成先剥 ANSI、再摘行尾回车、最后取最后一段 ——
  顺序错了就出错（转义码夹在回车两边，带着它们判必然拼帧）。
- **热重载后 cursor 失效却判不出来**：靠「序号是否连续」识别缓冲重建是错的 ——
  新缓冲可能已经输出到旧 cursor 之后，看起来完全连续，于是新内容前面几行永久丢失、旧行残留。
  改成给缓冲一个 `epoch` 代号，变了就清屏全量重拉。
- **首屏把「从未启动」说成「外部实例」**：只按 `managed` 二分，未启动时 `managed` 也是 false。改成按 `state` 分支。
- **计数比的是服务端总数**：PAGE=60 的库里没滚到底会显示「37 / 363」，像藏了 326 张。改成比「已加载」的条数。
- **隐藏后的「全选」会连带删掉看不见的**：`selectAllShown` 用的是未过滤全量列表 —— 隐藏 30 张后全选 39 张，一次删除把它们一起删掉。灯箱同源：按 → 会翻到隐藏的图，计数显示成「30 / 9」。三处都改成走过滤后的列表。
- **悬浮面板在指针到达前消失**：`top: calc(100% + 6px)` 中间是真空，鼠标斜着移过去时 `:hover` 断掉。改成面板自身 `padding-top` 撑间距；触屏没有 hover，补 `@media (hover:none)` 常驻。

## 0.3.0

### 新增

- **Danbooru 标签库组件**（`comfyui-workbench:danbooru`，可单独开关）：`danbooru_lookup` 支持按中文名或 Danbooru tag 查角色 / 画师，`danbooru_sync` 支持从 Danbooru 自抓。查询同时接受中文名、日文名与 Danbooru tag，空格与下划线等价，结果按「tag 名 → 别名精确 → 前缀 → 包含」分档、同档按帖子数降序。**输出只含 tag**（不带 postCount / 别名 / 匹配方式，避免挤占上下文）。本地库为空或没命中时自动走在线查询（`source: 'online'`），没同步过也能用。

  **数据随包内置**：`data/danbooru/` 里带 60,265 条（角色 35,384 + 画师 24,881，约 12MB），装好即可离线查询，不必先联网同步。来源是社区维护的中文库 [`danbooru-tags-data-zh`](https://github.com/amenorira/danbooru-tags-data-zh)（MIT，© 2026 amenorira），含中文名、别名（社区昵称如「葱娘」）与注释；上游 LICENSE 随数据保留。去掉被多条记录共用的别名后，角色 98.7% / 画师 94.9% 有中文名或别名（上游 CSV 为 99.7% / 95.8%）。`npm run danbooru:zh` 约 5 秒可重新导入（视网速）；自抓 wiki 作为补充路径保留（数据更新更及时，但对画师几乎拿不到中文名 —— Danbooru 平台不填 `other_names`）。

  **数据源降级**：`safebooru.donmai.us` 是 Danbooru 官方镜像（同接口、同数据，实测 `post_count` / `other_names` / 别名反查结果逐字段一致）。主站超时（8 秒）、`5xx`、`429` 或端点 `404` 时自动切换，`404` 也算镜像不可用 —— Danbooru 的"查无此项"是 `200 + []`，`404` 只表示这个站没有该端点。切过一次之后优先走能用的那个。`aibooru.online` 这类"同一套软件、不同数据库"的站不能当镜像（`hatsune_miku` 只有 1821 帖 vs 主站 148311）。

  **随包附带两个数据脚本**：`import-danbooru-zh.mjs`（从上游 CSV 重新导入）与 `sync-danbooru.mjs`（从 Danbooru 自抓），装包的人不必 clone 仓库就能自己更新数据。刻意排除了 `build.mjs`（依赖 devDep `esbuild`，装后跑必然 `ERR_MODULE_NOT_FOUND`）与 `acceptance.mjs`（打本机端口、写真数据目录）。

### 修复

含 0.3.0 新组件在开发期发现并修掉的缺陷（0.2.0 没有这个组件，升级者不会踩到）。

- **产物落到不相关的工作区**：`workspaceRegistry` 只知道有哪些工作区、不知道当前会话属于哪个，cwd 匹配不上时取列表首项 —— 而那个顺序与用户当前在哪个工作区无关，于是图落进了别人的目录。改成执行期用 `workingDirectory.get(session)` 取会话自己的工作区（`comfyui_run` 的 `exec.agent` 就带着 session），续查分支同步；`<会话工作区>/comfyui-output` 一棵并进写入授权，相册的读取授权也追加同一份（只修写入侧会变成"产物落对了、相册却列不出来、`/file` 还 403"）。该目录做 `canonical`，否则工作区是 junction / 符号链接时产物目录会把自己拒掉。配置项 `outputDir` 仍然最优先；面板直连（`runMode=direct`）与面板续查没有会话上下文，仍用启动期目录。
- **热度阈值是死旋钮**：参数写成 `post_count_gte`（Danbooru 不认，静默忽略），无论传多少都返回最热的那批。正确写法是 `search[post_count]=>N`。
- **限流下别名大面积丢失却报"同步完成"**：网络错误被一律当成"查不到"，覆盖率从 94% 掉到 61% 而日志正常。现在区分失败与空结果，日志报失败条数，退避吃服务端 `Retry-After`（30 秒上限）。
- **在线查询给出与本地不同的答案**：取 wiki 返回的第一条（顺序不代表热度）。改为逐条回查 `post_count` 后取最热。
- **在线被限流时静默返回空**：用户分不清"名字错了"与"被限流"。现在两种文案分开。
- **`404` 判定用错误文本匹配**：tag 名里可能含 404。改用状态码。
- **脚本参数传非法值时回退成 1/NaN**：`--min` 不带值会让 `Number(true) = 1`，静默跑成全量（全量 40 万条，实测 3~4 条/秒，约 30 小时）。现在挡类型。

### 工程

- **测试一直在测旧的 `lib`**：`npm test` 直接跑产物，而改代码只改 `src` —— 忘了 build 就变成"测试全绿、发包是旧的"。加 `pretest` 自动 build，守护断言明确盯产物（`lib/entries/gallery.js`）而不是源码。另加 `prepublishOnly` 在发布前重建，保证包内 `lib` 与 `src` 同步。
- 修掉五处形同虚设的测试（都是变异验证揭出来的）：断言硬依赖本机磁盘路径；某条靠"路径不存在"蒙对了规则；只测工具函数、没测工具有没有把参数传下去；测试自己传参数，测的是"支持"而不是"接没接上"；守护读 `src` 而运行时走 `lib`。
- **用户自己的库不会顶掉随包数据**：读路径优先用户数据目录、没有才回退包内；写路径只写用户目录，
  且 `writeStore` 拒绝任何指向随包数据目录的目标（含大小写变体与子目录）—— 否则一次写错就把随包的 12MB 覆盖掉。
- `files` 去掉一个不存在的根级 `client.js`。

## 0.2.0

### 修复

- **POSIX 上授权校验可被大小写绕过（读删越权）**：仓库里有两份 `authorize` / `roots` 实现 —— `shared/authz/` 一份，`panel-gallery/server/assets/` 一份，生产路由用的是后者。修前一份时漏了后一份，而它按 `toLowerCase()` 比较路径：POSIX 路径大小写敏感，`/data/App/x.png` 会被判在根 `/data/app` 之内而**放行**，随后 `statSync` / `unlinkSync` 用的却是原始路径 —— 校验通过的是 A，实际动的是 B。现在两处各一行 `export * from shared/authz/*`，只保留一份实现；折叠规则抽成 `foldPathCase`（Windows 折叠、其余平台原样），授权 / 根去重 / 缩略图缓存 / 扫描去重 / 工作区探测五处共用。
- 顺带补了两条此前抓不住的断言：同前缀兄弟目录（`/data/apple` 不属于 `/data/app`，把分隔符判断退化后会误放行），以及用 ghost 路径测 POSIX 大小写拒绝（不存在的路径会让 `canonical` 回退 `path.resolve`、保留原样）。
- **产物落到插件私有目录，而不是用户的工作区**：服务名取错。宿主服务叫 `workspaceRegistry`，`workspace` 只是它在 storages 里的**域名**（`workspace.json` 的 `unit.name`）—— 代码按域名去取，`ctx.get('workspace')` 恒为 `undefined`，工作区探测永远跳过这一级，产物一路退到 `~/.dsh-comfyui-workbench/outputs`，且没有任何报错。同时把 `workspaceRegistry` 加进包根 entry 的 `inject`：它不是"可见性"开关（`ctx.reflect.get` 本就不要求注入），而是**时序**——服务未就绪时 fiber 处于 INACTIVE、`apply` 不执行，探测会等它 ACTIVE 之后再跑。`GET /config` 的 `workspaceProbe` 可复核（`serviceCount` 应大于 0、`outputSource` 应为 `service`）。
- **同一工作区因路径大小写/分隔符不同而认不出来**：Windows 路径大小写不敏感、宿主给的 path 也可能是正斜杠，直接字符串比较会漏匹配、退回列表首项。比较前统一分隔符，并在 Windows 上折叠大小写（Unix 保持敏感，避免 `/srv/App` 与 `/srv/app` 撞在一起）；返回给调用方的仍是宿主原始形态。
- **多工作区时产物落到父工作区根下**：`related` 用 `paths.find` 取第一个前缀匹配，而 `D:\dsh` 与 `D:\dsh\notes` 可能都是 cwd 的祖先，靠前的先命中就返回。改为归一化分隔符后按路径长度降序取**最深**的那层。顺带修了正斜杠路径比不中的问题（Windows 下 `D:/x` 与 `D:\x` 直接比较永远不等）。
- **`comfyui_run` 的 `wait` / `waitMs` / `tags` 从未生效**：`execute` 一直在读这三个参数，但 schema 里没有声明，`additionalProperties:false` 下模型根本传不进来——「默认异步、可选同步等待」里的同步分支是死代码，产物索引的 tags 也恒为空。已补进 schema（`timeoutMs` 标为已弃用，语义并入 `waitMs`）。
- **出图通知可能重复投递**：`watchRun` 用 `setInterval` 轮询且不等上一轮 async 结束，`stop()` 又排在两个 `await` 之后 —— 响应稍慢时两个 tick 会同时读到 done，各投递一条通知（全量跑测试约 1/3 概率出现"收到 2 条"）。补 `settled`（只交付一次）与 `inflight`（防重入，`finally` 复位）守卫，完成 / 失败 / 超时三条路径语义一致；`settled` 只在真正投递前才置位，拼装通知文本若抛错仍会走失败通知而不是静默。另外两处 `logger.warn` 调用各自包了 `try` —— logger 是外部注入的，它自己抛错不该让通知丢失，更不该逃逸成 unhandledRejection（Node 默认因此结束宿主进程）。
- **五条 entry 面板全空**：组件 entry 是独立 bundle，`runtime.ts` 被各内联一份，模块级单例在 entry 之间不共享（`globalThis` 实测同样不共享），五个 prefix handler 各看各的路由表，导致 `/config`、`/workflows` 全 404、资产库与工作流面板同时为空。共享锚点改为 `ctx.root`（cordis 里所有 entry 的唯一共同原点，已用宿主 asar 内的 cordis 4.0.5 实测确认）。同时把 ComfyUI 客户端 / 进程托管 / 资产索引从「每条 entry 各建一份」收敛为一份。
- **重载后相册 404、要第二次重载才自愈**：core entry 只 `acquire` 不 `release`，引用计数永不到 0，旧运行时带着失效的 ctx 存活，重载时挂 effect 抛 `cannot create effect on inactive context`。现在 acquire / release 配对，卸载后 `refs=0`、`supervisor.dispose` 恰好调用一次。连续三轮全卸载→重载实测：prefix `1→0→1`、三个接口始终 200。
- **`ensureHttp` 先置位再注册**：失败或热重载后 `httpMounted` 恒为 true，前缀永不重新注册。改为注册成功后才置位，disposer 里复位。
- 注册类操作（`ensureHttp` / `track`）改用**调用方** ctx，不再用创建者的 —— 创建者 entry 卸载后再挂 effect 会抛。
- 被 `disabledComponents` 关掉的组件先判配置再 `acquire`，不再白建一份客户端与监督器；core 补 `inject: ['webServer']`，避免 HTTP 前缀落到某个组件身上（单独关它会整体失效）。
- `/workflows` 的批量导出实现留在相册（要读图、sidecar、打包），但不再挂进相册路由表，改由工作流组件的 POST 转发，消除两边抢同一路径的覆盖。
- 出图通知把消息来源写成 `{ kind: 'plugin', plugin: …, form: 'notice', summary: … }`，会话格式 v4 明确拒绝这个写法（`format v4 message requires a producer-owned source kind`），`Agent.followup` 在落事件时抛 `SessionFormatError`：通知永远发不出去，异常还发生在 agent 的 inbox 写入路径上，会把发起会话的驱动留在异常态（表现为那个对话再也接不到新消息）。现改为 v4 合法的 `{ kind: 'plugin:dsh-comfyui-workbench' }` —— 正是 v3→v4 迁移把旧写法改写成的形状。
- 通知投递一律经 `deliver()` 兜住异常并记日志，超时/完成/失败三条路径都不再把异常抛回宿主。
- `comfyui_run` 不再把产物作为 MCP 风格的内联图片块返回。宿主把工具结果的每个块按 `{type:'image', attachment}` 重建模型请求，裸 base64 块会让请求装配读到空 attachment 而抛错，被 LLM 适配器包装成 `TRANSPORT`；该块一旦落进会话历史，**这个会话之后每次请求都失败**（重进会话仍只报 `TRANSPORT`）。现在工具响应只含文本：路径、MIME、体积、原始宽高。
- `ToolBlock` 收窄为 `ToolText`，`ToolImage` 类型移除；`returnImages` 工具参数与同名配置字段保留但已弃用，只为兼容旧调用与旧配置。

### 清理

- 删除 `isDeadCtx`（判 `fiber.active` 在 cordis 4.0.5 下恒不成立，属死代码）、`runtimeReady`（无调用者）、`Runtime.ownerCtx`（只写不读）。
- 移除 `lib/{gallery,generate,edit}.js` 三个历史遗留产物（entry 产物已迁到 `lib/entries/`，这三个不再生成、全仓无引用）。

### 客户端

- 工作台外壳：资产库 / 工作流两个页签，共用侧边栏入口与 better-sidebar 页签。
- 工作流面板：选择器（标题 · 底模 · 备注）、只有输入输出的表单、advanced 折叠、输出区。
- 两种运行方式：**发进对话**（把结构化参数填进输入框，由模型调 `comfyui_run`）与**直接生成**（HTTP 直连，不消耗模型往返）。
- 参考图转提示词：图与固定格式指令一并填进输入框。自动回填依赖"订阅本会话新消息"，该能力尚未验证，因此当前停在"填好等你按回车"，并在找不到输入框时明确报错。

### 服务托管

- 探测：环境变量 `COMFYUI_HOME` / `COMFYUI_PATH` / `COMFYUI_DIR` → 常见位置；判据是"有 `main.py` 且有 `models/`"。
- 三种状态：外部在跑（只用不托管）、未跑但已安装（按需拉起）、未跑且未安装（报错给指引）。
- 只停**自己拉起的**进程；外部实例永不触碰（有测试钉住）。
- 空闲回收；拉起期间请求排队等待而不是立刻失败。
- `GET /service` 看状态（state / managed / pid / installDir / detail），`POST /service/stop` 停自己拉起的那个。

### 迁移

- `node scripts/migrate-album.mjs [--write]`：把相册的 roots / 扫描上限抄到本插件数据目录，不碰产物、不改 profile 装载行。

### 工程

- 测试覆盖：架构、静态、类名、宿主接口、客户端渲染、IO 面与变量、索引、执行链、HTTP 契约、服务托管、通知投递、组件隔离、目录解析。

## 0.1.0

首个版本：把 `dsh-comfyui-album` 的资产浏览能力整体继承过来，并加上工作流执行。

### 资产库

- 侧边栏入口 + 主面板；装了 `dsh-better-sidebar` 时注册页签，未装静默缺席。
- 搜索、根目录筛选、仅生成图、分页、手动重扫。
- 悬浮动作：复制图片、复制提示词、导出工作流、加入当前对话、删除。
- 灯箱：缩放、适应窗口、←→ 翻页、ESC。
- 多选：全选 / 清除 / 批量导出工作流（ZIP）/ 批量删除。
- 同图副本合并（`seed + 尺寸 + 提示词` 签名，不做内容哈希 —— 编码差异会导致漏合并）。
- 元数据：sidecar 优先，缺失时回退 PNG 内嵌工作流。

### 工作流

- `dsh workbench import`：只接受 API 格式；UI 格式给出 Export (API) 指引。
- IO 面推断：连线跳过、内部参数跳过、正负提示词按采样器回溯命名、`basic` 段只收提示词与图像。
- `applyVariables`：`bind` 路径写入 + `{{var}}` 按值替换（整串占位符保类型，数字不退化字符串）。
- 四个工具：`comfyui_workflow_list` / `comfyui_workflow_inspect` / `comfyui_run` / `comfyui_workflow_edit`。
- 执行：预检 → 提交 → 轮询 → 超时必发 `/interrupt` → 取产物 → sidecar。
- 工具响应带回图片块，并在文本中声明原始像素尺寸。

### 索引

- JSONL 追加式索引，可删可重建（真源是 sidecar）。
- `GET /assets`（q / workflow / tag / kind / status / 游标）、`POST /assets/rebuild`。

### 工程

- 全部 TypeScript，按域分层（scan / host / assets / workflow / comfy / run / store / tools / http / client）。
- `tests/arch.mjs` 把依赖方向约束变成可执行检查。
- 运行时零依赖（只用 `node:*`），构建期只依赖 typescript + esbuild + @types。
- 22 项测试：架构、静态、宿主接口、客户端渲染、IO 面与变量、索引、执行链（本地假 ComfyUI）。
