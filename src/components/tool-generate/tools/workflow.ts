/**
 * `comfyui_workflow`：工作流这一个对象上的所有只读视角。
 *
 * **四档，靠参数决定，不靠不同的工具名**：
 *
 * | 给什么 | 得到什么 |
 * | --- | --- |
 * | `audit: true` | 全库体检：哪些模板缺节点（必然跑不起来）、哪些缺模型（会跑偏） |
 * | `workflowId` | 那套模板的输入输出面 + 节点清单 + 缺失预检 |
 * | `workflowId` + `nodeId` | 那一个节点的完整配置（含连线来源） |
 * | 都不给 | 列表（可 `q` 过滤、`inputs` 按输入类型筛、`includeDisabled` 含停用） |
 *
 * 为什么合成一个：这四档都是**同一个对象上的只读查询**，失败后的下一步也相同
 * （要么换 id、要么去启用/导入）。原来拆成 list / inspect 两个，模型得先判断
 * "我现在该调哪个"——那是个假选择。而体检本来会变成第三个工具，直接挂在这里不占位置。
 *
 * 实现分在三个文件里（list / inspect / audit），这个文件只做分派与 schema ——
 * 各自逻辑留在各自文件，方便单独测。
 *
 * **降档必须报错，不能静默**：只给 `nodeId` 不给 `workflowId` 时，如果照旧回列表，
 * 模型会以为自己看的是某个节点的配置。这类"参数给错但拿到 200"最费调试时间。
 */
import { asString, jsonOutput } from '../../../shared/tools/types.js'
import type { ToolDeps, ToolSpec } from '../../../shared/tools/types.js'
import { auditWorkflows } from './workflow-audit.js'
import { inspectWorkflow } from './workflow-inspect.js'
import { listWorkflows } from './workflow-list.js'

/**
 * `audit` 的真值判断。
 *
 * 宽容一点点：模型偶尔给 `'true'` 或 `1` 而不是布尔。严格 `=== true` 会让它静默降档成列表 ——
 * 那比报错更糟，因为它以为自己做了体检。
 */
function wantsAudit(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/**
 * @param deps - 依赖（工作流目录 + ComfyUI 客户端）。
 */
export function workflowTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_workflow',
    description:
      '工作流的**一个入口，四档视角**：不给 `workflowId` 列清单（含 id、标题、作用备注、底模、输入种类、输出形状）；'
      + '给 `workflowId` 看那套的输入输出面与节点清单（`inputs` 里就是 `vars` 能用的键名）；'
      + '再加 `nodeId` 看单个节点的完整配置；给 `audit: true` 体检全库 —— 哪些模板缺节点（必然跑不起来）、'
      + '哪些缺模型（能提交但会跑偏）。'
      + '**服务没在跑时它会先自动拉起**（最多 3 分钟），第一次调用慢是正常的，'
      + '不要因为慢就以为卡住了、更不要手动去启动或 kill ComfyUI。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workflowId: { type: 'string', description: '工作流 id。给了它就看这套模板的细节，不是列表。' },
        nodeId: { type: 'string', description: '只看这一个节点（**必须同时给 workflowId**）。' },
        audit: { type: 'boolean', description: '体检全库：扫所有模板，报告缺节点与缺模型的情况。**给了它就忽略 workflowId。**' },
        q: { type: 'string', description: '列表时按标题 / 备注 / 模型名过滤（不区分大小写）。' },
        inputs: {
          type: 'string',
          enum: ['image', 'mask'],
          description: "列表时只看需要这类输入的工作流（找'能吃图的工作流'就用 image）。结果里会标 imageSlots 与 needsImage。",
        },
        includeDisabled: { type: 'boolean', description: '列表时连被管理员停用的工作流一起列出（默认只看可用的）。' },
      },
    },
    output: jsonOutput(),
    async execute(args) {
      // 体检优先：它和 workflowId 同时给时以体检为准（体检扫的是全库，workflowId 无意义）
      if (wantsAudit(args.audit)) return auditWorkflows(deps)

      const workflowId = asString(args.workflowId).trim()
      if (workflowId !== '') return inspectWorkflow(deps, args)

      // 只给 nodeId 是走不通的组合：静默回列表会让模型以为自己看到了节点配置
      if (asString(args.nodeId).trim() !== '') {
        return {
          ok: false,
          mode: 'node',
          message: `nodeId 要配合 workflowId 一起给 —— 得先知道是哪套模板里的节点。`
            + '先不带参数调用一次拿到 workflowId，再加上 nodeId。',
        }
      }

      return listWorkflows(deps, args)
    },
  }
}
