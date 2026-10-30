# dsh-comfyui-workbench

**中文** · [English](README.en.md)

给 [DSH](https://github.com/deepseek-ai) 的 ComfyUI 工作台：**把本机的 ComfyUI 工作流交给模型调用**，并管理"哪些工作流对模型可用"。

面向用户的界面只有三块：资产库、工作流管理、ComfyUI 终端 —— 都由 ComfyUI 原生能力支撑，不新增一套平行的状态。**不内置生图前端** —— 想手工出图直接开 ComfyUI 就行。

> 本插件是 [`dsh-comfyui-album`](https://github.com/YuChenLiao/dsh-comfyui-album) 的继任者，资产浏览能力从相册继承（源码同源）。两者同时启用会出现两套入口与两套删除按钮，建议卸载相册。`scripts/migrate-album.mjs` 只在仓库里有 —— 装了包的人要迁移得先 clone 仓库，在仓库目录里跑。

## 六个组件

装载在 profile 的 `cordis.patch.yml` 里，每一条都是独立的 loader entry —— 在宿主「设置 → 插件」里能看到、能单独开关。

| entry | 形态 | 职责 |
| --- | --- | --- |
| `comfyui-workbench:core` | 服务端 | 初始化共享运行时（ComfyUI 客户端 / 进程托管 / 资产索引 / 产物目录）；承载浏览器端。**name 必须是包根**，宿主只给包根装配 `exports["./client"]` |
| `comfyui-workbench:gallery` | 面板 | 资产库：列表、筛选、缩略图、删除、批量导出工作流 ZIP |
| `comfyui-workbench:workflow` | 面板 | 工作流管理：列表、`enabled` 开关、用途备注，外加 `/run`、`/config`、服务托管接口 |
| `comfyui-workbench:generate` | 工具 | `comfyui_workflow_list`、`comfyui_workflow_inspect`、`comfyui_run`、`comfyui_run_batch`、`comfyui_node_search` |
| `comfyui-workbench:edit` | 工具 | `comfyui_workflow_edit` |
| `comfyui-workbench:danbooru` | 工具 | `danbooru_lookup`、`danbooru_lookup_batch`、`danbooru_sync`：角色 / 画师标签库（含中文名）。不碰 ComfyUI 运行时，可单独关 |
| `comfyui-workbench:terminal` | 面板 | ComfyUI 终端：展示子进程输出或 `user/comfyui.log`，可在面板上直接拉起服务 |

关掉某一条只影响它自己：例如关掉 `gallery`，资产库路由随之 404，工作流管理与工具照常（两个例外：批量导出工作流 ZIP 要读图与 sidecar，依赖相册；关掉 `core` 等于关掉整个插件——HTTP API 与浏览器端都会消失）。

## 安装

```sh
# 发布态
dsh plugin --profile desktop add github:YuChenLiao/dsh-comfyui-workbench

# 本地开发
dsh plugin --profile desktop add link:D:/dsh/dsh-comfyui-workbench
```

装完重启 DSH。`cordis.patch.yml` 里会插入七条 entry（包根 core + 六个组件），配置用 YAML 锚点共享，只写一次：

```yaml
- insert:
    - id: comfyui-workbench:core
      name: dsh-comfyui-workbench
      config: &cwf
        baseUrl: http://127.0.0.1:8188
        autoStart: true
        disabledComponents: []
    - id: comfyui-workbench:gallery
      name: dsh-comfyui-workbench/gallery
      config: *cwf
    # :workflow / :generate / :edit / :danbooru / :terminal 同理
```

## 配置

| 字段 | 说明 |
| --- | --- |
| `baseUrl` | ComfyUI 地址，默认 `http://127.0.0.1:8188` |
| `outputDir` | 产物目录。**留空则落在 `<当前工作区>/comfyui-output`**；探测不到工作区时回退到 `<插件数据目录>/outputs`（`GET /config` 的 `outputSource` 会显示 `data`，`workspaceProbe` 给出探测过程：`cwd` 是否被判为宿主内部目录、`workspaceRegistry` 服务取到几个路径）。要钉死位置就显式配置这一项 |
| `workflowsDir` | 工作流仓库，默认 `~/.dsh-comfyui-workbench/workflows` |
| `autoStart` | 探测到本机安装时是否自动拉起 ComfyUI；只停自己拉起的进程 |
| `disabledComponents` | 关掉的组件，如 `['panel.gallery']`。空数组即全开 |
| `timeoutMs` | 单次 HTTP 请求超时，同时是 `comfyui_run` 的默认等待上限 |
| `pollIntervalMs` | 执行状态轮询间隔 |
| `roots` | 额外纳入资产库的目录（默认已含当前工作区、`dsh-comfyui-image` 的 `outputDir`、产物目录） |
| `assetRoots` | 额外的**可写**根。`assertWritable` 取的是全部授权根的合集（`roots` / 工作区 / cwd / 产物目录 / uploads / assetRoots），只有落在合集之外才拒绝写入 |

## 模型工具

| 工具 | 作用 |
| --- | --- |
| `comfyui_workflow_list` | 列出**可用的**工作流：id、标题、用途备注、底模、输入种类、输出形状。被停用的不列出（`hiddenCount` 告知藏了几条）。拿不到 `/object_info` 时不标缺模型，避免把"离线"说成"缺模型" |
| `comfyui_workflow_inspect` | 不传 `nodeId` 给 IO 面与节点清单；传了给单节点完整配置。顺带报告缺节点、缺模型与可用的替代 |
| `comfyui_run` | **默认异步**：提交后立即返回 `promptId`，后台盯着并在出图后主动通知对话。支持 `wait: true` 同步等、`promptId` 续查。停用的工作流直接拒绝 |
| `comfyui_workflow_edit` | 改标题 / 说明 / 标签，以及单节点参数。默认只影响下一次运行，写回模板需 `persist` + `expectHash`。被变量绑定的参数不能在这里改（会报 `param_bound`），变量请经 `comfyui_run` 的 `vars` 传 |
| `comfyui_node_search` | 按类名 / 显示名 / 别名 / 分类 / 输入输出类型 / 包名搜索本机节点，四档排序。默认只回一行摘要，`detail` 才给输入输出 |
| `comfyui_run_batch` | 一次提交多个任务（同一工作流跑多组参数，或不同工作流各跑一次）。逐条报结果，**一条失败不影响其它条**；默认全部异步 |
| `danbooru_lookup` | 按中文名 / 日文名 / Danbooru tag 查角色与画师，**只返回 tag**。写提示词前用它对齐名字，能少跑偏 |
| `danbooru_lookup_batch` | 一次查多个名字（上限 50），**只查本地不联网** —— 缺哪个再用单条 `danbooru_lookup` 补（那个会自动走在线） |
| `danbooru_sync` | 把角色 / 画师标签（含中文名）抓到本地库。几千次请求，只在用户明确要求时调用 |

工作流的"可用"由 `<id>.meta.json` 的 `enabled` 决定（缺省 `true`），面板与 `comfyui_workflow_edit` 写同一份文件。

## Danbooru 标签库

模型写提示词时常常知道「甘雨」却不知道 `ganyu_(genshin_impact)`，或者反过来。`danbooru_lookup` 把两边对上，**只返回 tag**：

```json
{ "ok": true, "tags": ["ganyu_(genshin_impact)"], "source": "local" }
```

上下文是稀缺资源，所以结果里不放 `postCount`、别名列表、匹配方式这些 —— 模型要的只是"这个名字对应哪个 tag"。

**主站挂了会自动换镜像**：`safebooru.donmai.us` 是 Danbooru 官方的 SFW 镜像 —— 同一套接口、同一份数据（实测 `post_count`、wiki 的 `other_names`、别名反查结果与主站逐字段一致）。主站超时（8 秒无响应）、`5xx`、`429` 或端点 `404` 时自动切过去，查询结果不变。切过一次之后会优先走能用的那个。

不能用的是 `aibooru.online` 这类「同一套软件、不同数据库」的站：它的 `hatsune_miku` 是 1821 帖而主站是 148311，拿它当镜像会给出错误的热度与结果。

**本地没数据也能查**：库为空或没命中时会自动走 Danbooru 在线接口（`source` 变成 `online`）。中文/日文名走 `search[other_names_match]`（这是 Danbooru 唯一能按别名反查的字段），纯英文名走 `search[name_matches]` 模糊匹配 tag。所以没同步过也能立刻用，只是慢一点、且每次查询都打网络。

**首选数据源**是 [`danbooru-tags-data-zh`](https://github.com/amenorira/danbooru-tags-data-zh)（MIT，© 2026 amenorira）——**数据随插件内聚在 `data/danbooru/`**，装好即可用，不必先联网同步：社区维护的中文翻译库，收录 Danbooru 上图片数 > 50 的标签，含中文名、别名（社区昵称也有，比如初音的「葱娘」）和一句注释（注释只入库、不进查询结果 —— 模型只需要 tag）。实测覆盖：角色 **35384 条**、画师 **24881 条**；上游 CSV 里 99.7% / 95.8% 有中文名或别名，随包这份去掉共用别名（CP 名等）后是 **98.7% / 94.9%**。这比自己抓 wiki 强得多 —— 那份方案对画师几乎拿不到中文名（Danbooru 的画师 wiki 不填 `other_names`），而且 400 条就要 100 秒。

想把本地库更新到上游最新，下面几条按需选一条（命令要在 `package.json` 所在目录执行 —— 仓库根，或安装目录里的 `node_modules/dsh-comfyui-workbench/`）：

```sh
npm run danbooru:zh                        # 拉上游最新数据到插件数据目录（约 5 秒，视网速；首次要下几 MB CSV，可能 10 秒上下），覆盖本地的旧副本
npm run danbooru:zh -- --kind character    # 只导入角色
npm run danbooru:zh -- --dry               # 只看会导入多少条
```

注意它写的是**插件数据目录**（`~/.dsh-comfyui-workbench/danbooru/`），不会动仓库里的 `data/danbooru/` —— 后者是随包分发的快照。想把随包数据也更新，导入完再把它同步过去：

```sh
cp ~/.dsh-comfyui-workbench/danbooru/*.jsonl data/danbooru/
```

**补充路径**：也可以直接从 Danbooru 抓（`tags.json` + 逐条 `wiki_pages.json`），数据更新更及时、能拿到 wiki 里最新的别名，但请求量大、适合只抓热门段：

```sh
npm run danbooru:sync                      # 热度 ≥ 100，每类最多 3000 条
npm run danbooru:sync -- --min 0 --max 0   # 全量（角色 tag 40 万+，按实测速率 30 小时上下）
```

`--min` 是热度门槛（走 `search[post_count]=>N`），`--max` 是每类条数上限，`0` 表示不限。全量很慢 —— 瓶颈是逐条查 wiki，实测 8 并发下约 3~4 条/秒，40 万条要 30 小时上下。`--max` 就是为这个准备的：先拉热门段（比如 `--min 300 --max 400`，两类合计约四分钟），需要时再放宽。

**万一本地库是空的**（旧版本安装、或只拷了 `lib/` 的装置 —— `github:` 安装按 `files` 打包、`link:` 直接指向仓库，两种都带 `data/`）：查询会自动走在线（`source: online`），功能不中断，但慢一个数量级 —— 实测本地 **约 30~70 毫秒**（默认查角色+画师；新进程首查约 0.13 秒，要解析 12MB JSONL），在线 **约 1 秒**（纯英文 tag，每类一次模糊匹配）/ **约 2 秒**（中文名单候选）/ **4~6 秒**（中文名多候选：先 wiki 反查、再逐条回查热度），网络差时更久。结果也更窄：本地对「圣园未花」会给 `mika_(blue_archive)` 及其泳装、体操服变体共 3 个 tag，在线只回主 tag 一个。

想补数据：

```sh
# 同上：cwd 必须是 package.json 所在目录，否则 npm 报没有该 script
cd <安装目录>/node_modules/dsh-comfyui-workbench && npm run danbooru:zh

# 或者任意目录，直接给脚本路径（与 cwd 无关）
node <安装目录>/node_modules/dsh-comfyui-workbench/scripts/import-danbooru-zh.mjs
```

它写的是**插件数据目录**（`~/.dsh-comfyui-workbench/danbooru/`），不是安装目录里的 `data/` —— 后者是随包快照，运行时不写它（安装目录也可能只读）。

想手工补单条也可以，但要清楚三件事：

一是**按 kind 分文件**取代：只写 `characters.jsonl` 只影响角色；画师不受影响，仍走它自己那份（插件数据目录里没有 `artists.jsonl` 时才回退随包）。二是 `>>` 是追加，跑过 `danbooru:zh`、已经有全库的，追加就是在库尾加一条（在下次导入前只增不减）；只有靠随包快照、还没有自己那份时，新建这个文件才会让那一类只剩这一条（角色 35384 条 / 画师 24881 条被整体遮蔽）。三是补完要**重启插件**：已经查过该类的话，标签进了内存缓存，不重启看不到改动。

```sh
mkdir -p ~/.dsh-comfyui-workbench/danbooru
echo '{"tag":"mika_(blue_archive)","kind":"character","postCount":16024,"names":["圣园未花"]}' \
  >> ~/.dsh-comfyui-workbench/danbooru/characters.jsonl
```

格式是 JSONL，**不是**上游的 CSV（运行时只读 `<kind>s.jsonl`，CSV 放进去会被忽略）。

`danbooru:zh` / `danbooru:sync` 写入时都是**整份替换**：会重写整个 `<插件数据目录>/danbooru/<kind>s.jsonl`（先写临时文件再 rename，中途失败不会留半个文件）。所以上面手工追加的那几条，跑一次导入或同步后会被覆盖掉。

**没有别名时不会留空**：这类条目（随包数据里角色 473 条、画师 1258 条）的 `names` 是空数组，但仍能按 tag 名查到 —— 查 `chainsaw_man_(character)` 返回的就是它自己，`danbooru_lookup` 返回的永远是 Danbooru 认的那个标准名。

自抓路径（`danbooru:sync`）会过滤掉二创活动名、带年份的、纯英文变体；导入中文库（`danbooru:zh`）则照单全收 —— 那份数据的别名本来就经过整理，含社区昵称与旧译名。**CP 名**（`レイマリ` 这种两人合称）主要靠「是否被多个 tag 共用」判断 —— 那比猜字符可靠，也不会误伤 `初音ミク`；共用时只保留在热度最高的那条记录上。另有一层保守的字符过滤（带 `×`/`&` 之类的、字面含 `cp` 的、单独一个关系词的）。这样每个别名最多对应一条结果，不会出现"查一个名字弹出两个人、都标精确"。

同步时若遇到限流或网络错误，会退避重试；仍失败的条目会在日志里报出条数（这些条目别名缺失，重跑一次即可补上）。

本组件可以单独关掉（宿主插件页，或配置 `disabledComponents: ['tool.danbooru']`），不影响生图链路。

## 隐藏 NSFW

资产库工具条上，刷新按钮右侧有个省略号 —— 悬浮展开「隐藏 NSFW」。点了之后列表里判定为 NSFW 的资产会被藏起来，按钮旁显示藏了多少张。

判定是**启发式词表**，不是分类器。扫的是文件名、正向提示词、底模名与工作流 id：

- 强信号（`nsfw` / `explicit` / `hentai` / 性器官 / 中文「完全裸露」「完整裸露」「赤裸」「全裸」等）单命中即判
- 中信号（`nude` / `breast` / `lingerie` / 「裸露」「乳房」等）要凑够**两个**才算 —— 动漫 tag 里 `breasts`+`nipples` 是泳装与解剖图的标配，单命中必然误伤

**负向提示词不参与判定**。Danbooru 系底模（AnimagineXL / Pony）的官方推荐负向模板里就写着 `nsfw`，拿它判定会让一整套工作流的图全被藏起来，而那恰恰是在排除成人内容。

过滤只在渲染层：数据仍在内存里，切回「显示」立刻可见，不用重新拉。隐藏状态下的「全选」只会选看得见的那些 —— 否则一次删除会把看不见的一起删掉。

## 终端面板

第三个面板（继资产库、工作流管理之后），展示 ComfyUI 的**命令行输出**。想看服务在干什么、卡在哪一步、模型加载到几成 —— 这些只在终端里，GUI 上看不到。

- **外部启动的实例也能看**：插件拉起的进程直接接 stdout / stderr；外部实例（Desktop 自己起的那些）拿不到 stdout，改读它写的 `user/comfyui.log`。两条路只走一条 —— ComfyUI 的 logger 同时挂 Stream 与 File 两个 handler，两边都读是每行两份。
- 服务没在跑时，面板上有「启动」按钮，直接拉起，不用先回对话生成一张图。
- 1 秒轮询拉增量（带 cursor，不重复下载整屏）；自动跟随底部，但你往上翻时不会被拽回来。
- 支持暂停、按关键字过滤、清屏。缓冲保留最近 2000 行，更早的会滚出并提示。
- ANSI 转义（颜色、进度条的 `\r` 刷新）在入库前剥掉，否则是一屏乱码。
- 子进程被强制 `PYTHONIOENCODING=utf-8` —— Windows 上不指定的话 Python 按控制台代码页输出，中文全是豆腐块。

关掉它只影响这个面板（`panel.terminal`），其它组件照常。

## 产物与通知

- 产物默认写入 `<当前工作区>/comfyui-output`，主产物旁写一份 `<文件>.json` sidecar（提示词、seed、工作流、原始尺寸、promptId）；一次出多张时只有第一张带 sidecar。
- 图片**只给路径与原始像素尺寸**，不内联字节：宿主会按 `{type:'image', attachment}` 重建请求，裸 base64 会抛错并污染该会话的后续请求。
- 出图完成后由插件主动通知对话（`Agent.followup`，来源 `plugin:dsh-comfyui-workbench`）；完成 / 失败 / 超时三条路径都只投递一次。

## 目录结构

```
src/components/panel-gallery/     相册：server/(路由/扫描/索引/缩略图) + client/
src/components/panel-workflow/    工作流管理：server/(路由/运行/配置) + client/
src/components/tool-generate/     生图工具
src/components/tool-workflow-edit/ 工作流编辑工具
src/shared/                       公用逻辑：host / comfy / workflow / run / tools / http / authz / media
src/http/                         HTTP 前缀与分派（router）
src/client/                       UI 外壳：页签、api、i18n、图标
src/index.ts                      包根入口（承载浏览器端 + 初始化共享运行时）
src/entries/                      六个组件 entry 的入口（core 即 src/index.ts）
src/runtime.ts                    跨 entry 共享的运行时（锚点挂在 ctx.root 上）
```

`npm test` 的首项（`node tests/arch.mjs`）会强制三条边界：`shared` 内部单向（host 最底）、组件 `server` 不依赖任何 `client`、外壳公共模块不依赖具体组件。

## 开发

```sh
npm install
npm run build      # src → lib/index.js（宿主）+ lib/client.js（浏览器）+ lib/entries/*.js + lib/{workflow,store,run,comfy}.js（测试用）
npm test           # 架构 + 类名 + 宿主接口 + 客户端渲染 + 通知 + 组件隔离
npm run typecheck
npm run accept     # 对着跑着的 DSH 逐条打勾（真实环境验收）；-- --run 会跑一次完整出图
node scripts/compat.mjs   # 工作流兼容性扫描：缺节点 / 缺模型 / 需选图
```

`node scripts/smoke-workflows.mjs` 逐个真跑工作流（参数压到 512 长边、1 步），只验证"能提交、能出图、能取回"。

导入工作流：`node scripts/import.mjs <workflow.json>`（`--list` 看已有）。只接受 API 格式 —— UI 格式请在 ComfyUI 里用 Export (API)。

## 兼容

| 插件 | 关系 |
| --- | --- |
| [`dsh-comfyui-image`](https://github.com/wbb316/dsh-comfyui-image) | **配套**：读它落盘的图片与 sidecar，以及它配置里的 `outputDir`。不 import 它的代码 |
| [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) | **可选**：注册页签；没装不影响原生侧栏入口。页签需在侧栏「+」菜单里添加一次 |
| [`dsh-comfyui-album`](https://github.com/YuChenLiao/dsh-comfyui-album) | **前身**：建议卸载。迁移：在本仓库目录里跑 `node scripts/migrate-album.mjs --write`（该脚本不随包分发） |

## 文档

- 设计方案：[docs/design.md](docs/design.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

## 致谢

标签数据来自 [amenorira/danbooru-tags-data-zh](https://github.com/amenorira/danbooru-tags-data-zh)（MIT，© 2026 amenorira），收录 Danbooru 上图片数 > 50 的标签及其中文名、别名与注释。数据随插件分发在 `data/danbooru/`，上游的许可原文一并保留（见 [data/danbooru/LICENSE](data/danbooru/LICENSE) 与 [NOTICE.md](data/danbooru/NOTICE.md)）。

本插件只做了这些转换：字段名映射（CSV → JSONL）、按 `category` 过滤行、`names` 规范化（中文名前置、丢弃与 tag 同名的项、丢弃空串、记录内去重）、以及共用别名去重（去掉被多条记录共用的 CP 名等，同一别名只保留在热度最高的那条记录上）。tag、中文名与注释文本本身未改动。上游更新后按上文的 `danbooru:zh` 重新导入。

## License

MIT
