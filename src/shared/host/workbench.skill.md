# 这套 ComfyUI 工作台怎么用

插件把本机 ComfyUI 接进对话：六个面板给人看，十四个工具给模型用。
四层东西各管各的，混了就出问题 ——

| 层 | 在哪 | 规矩 |
|---|---|---|
| 模板 | `workflows/` 下的 **API 格式** JSON | 改参数用 vars；要把新值**存回模板**才用 `comfyui_workflow_edit` |
| 变量 | 模板的输入面 | `comfyui_run` 的 `vars`，键名来自 `inputs` |
| 产物 | `outputDir` + 同名 `.json` sidecar | 只读，sidecar 是复现凭据 |
| 素材 | 标签 99372 / 姿势 288 组 / 衣装 1407 套 | 只读，能搜、能取图 |

## 跑一次图的标准路径

1. `comfyui_workflow_list` 挑模板 —— 看 `models.primary`（底模）与 `description`（用途）。同名的模板靠这两项区分，别只看 id。
2. 第一次用某个模板，先 `comfyui_workflow_inspect` 看 `inputs`：那就是 `vars` 能用的键名，连同类型、默认值、取值范围。
3. `comfyui_run { workflow: { id }, vars: {...} }`。
4. 按返回的产物路径读原图；要改一点重跑用 `comfyui_rerun` —— sidecar 里存着 workflowId / hash / vars / seed，不用手抄。

## 三种常见误用

**为了改参数去改写工作流 JSON。** 模板 + 变量就是为此存在的。改文件会让这次运行无法追溯（sidecar 记的是这次提交内容的 hash，跟你手改的文件对不上），也让 `workflows/` 越堆越乱。一次性改动用 vars；要把新值固定下来用 `comfyui_workflow_edit`（见下一节）；只有要增删节点、换连线时才直接碰文件。

**把 UI 格式的 JSON 传给 `workflow.path`。** 带 `nodes` + `links` 的是 ComfyUI 界面工程文件，必须先「Export (API)」重新导出。工作流目录里的模板全是 API 格式，用 `{"id":"..."}` 就能跑，根本不需要 path。`path` 只用于目录之外的临时文件。

**改产物的 sidecar。** 它记着 workflowId / workflowHash / vars / seed，是"再来一张一模一样的"的唯一凭据；改过之后 `comfyui_rerun` 复现不出来。

## 把改动存回模板

一次性的参数用 `vars` 就够。要让它**一直生效**（以后不传也是新值），用 `comfyui_workflow_edit`：

1. `comfyui_workflow_inspect` 拿到当前的 `workflowHash`
2. `comfyui_workflow_edit` 传 `patches`（节点 id + 输入名 + 值）、`persist: true`、`expectHash`

`expectHash` 是并发保护：模板在这期间被别人改过就会拒绝，不会覆盖掉。**这是唯一该写模板的路径** —— 它改的是模板本身，带 hash 校验，也不产生副本。

## 素材三库的用法

- **标签库**（99372 条）：`danbooru_lookup` 把中文想法转成 tag。语义分类只覆盖 `general` 那 30693 条的 26.9%（不是 99372 的），查不到时先去掉 `category` 再试。
- **姿势库**（288 组 / 1439 角度）：`comfyui_pose` 给 `query` 找人，给 `id` 就把线稿落进 uploads → 当 ControlNet / 图生图的输入图。
- **衣装库**（1407 套）：`comfyui_costume` 给 `query` 搜，结果带 `keywords`（英文串，可直接拼进提示词）；给 `id` 就取图当参考。

素材工具都是**同一个工具两条路径**：给 `query` 是搜，给 `id` 是取图。不用先决定"该调哪个工具"。

要找"能吃图的工作流"：`comfyui_workflow_list { inputs: "image" }` 会给出 `imageSlots`，告诉你该往哪个键传图。

## 用素材出图

要"这套衣服 + 这个姿势出一张"，不必自己拼五步，用 `comfyui_compose`：

1. 先搜素材：`comfyui_costume` / `comfyui_pose` 给 `query` 拿到 id
2. `comfyui_compose { costumeId, poseId, tags, prompt }` —— 它把图落进 uploads、按槽位语义填好 vars、拼好提示词
3. 把返回的 `call` 原样交给 `comfyui_run`

它**不出图**，只产出参数。返回里的 `assumptions` 是槽位映射的推断依据：label 有语义就用 label，
否则看默认文件名（`pose_ref.png` 这种），再不行才按顺序。
**靠顺序猜出来的槽位会写进 `assumptions`**（靠 label 或默认文件名对上的不写 —— 那是证据不是猜测）；
不对就用 `extraVars` 覆盖。`dropped` 里的角色是没地方放的，不会静默丢。

正向提示词只写进**明确是正向**的槽：name/label 含 prompt/positive/正面 的。带 negative、
或看起来是文件名前缀的文本槽一律跳过 —— 宁可退回模板默认，也不把正向内容写进负向。

## 服务与等待

- 提交时会**自动拉起** ComfyUI，不必先手动启动；也不要 kill 它 —— 它可能正在下载或加载模型，打断会让它卡在自己的下载状态里。
- 一次出图实测中位 115 秒、最长 336 秒。用 `comfyui_runs` 查状态。**工具提交的运行只有排队位置，没有百分比** —— 精确进度只接在面板那两条路径上。
- 中间产物（保存节点的来源还被别的计算节点继续消费）**在有正式产物时**会被丢掉、不进资产库；如果这个工作流一个正式产物都没有，就会退而求其次把中间产物收下来。

## 什么时候用哪个

- 不知道有哪些模板 → `comfyui_workflow_list`
- 知道模板、要改参数 → `comfyui_workflow_inspect` 查完直接 `comfyui_run`
- 已有产物、想再来一张或做变体 → `comfyui_rerun`
- 要批量 → `comfyui_run_batch`（只投一条汇总通知，并按工作流分组提交，避免反复重载底模）
- 跑失败了 → 看返回的 `failureKind`，五类各有对应改法；节点是否存在用 `comfyui_node_search` 查
