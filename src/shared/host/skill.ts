/**
 * 把「这套工作台怎么用」注册成 DSH 的 embedded skill。
 *
 * 起因是实际使用中的观察：模型经常绕过 `vars`，改为复制/改写工作流 JSON、再用
 * `workflow.path` 跑。工具描述里已经写了"参数用 vars 传"，但**没写"改参数别碰文件"**，
 * 而 `path` 参数本身又像在暗示"你可以自己造一份"。契约层的缺口补过之后（见
 * `comfyui_run` 的描述与 `workflow` 参数的说明），这里补的是它表达不了的那部分：
 * 四层东西怎么分工、标准路径是什么、哪三种做法会把自己绕进去。
 *
 * 不是工具手册 —— 每个工具的参数在它们的 description 里，这里只讲**取舍与顺序**。
 * 正文放在 `workbench.skill.md`，构建时按文本内联（与样式表同一套 loader）。
 */
import type { HostContext } from './types.js'
import skillBody from './workbench.skill.md'

/** 技能名（kebab-case，宿主按这个加载）。 */
export const WORKBENCH_SKILL_NAME = 'comfyui-workbench'

/**
 * 描述决定模型**什么时候**加载它 —— 写得比正文还重要。
 *
 * 要覆盖三类触发场景：驱动出图、用素材拼提示词、排查产物/复现问题。
 */
export const WORKBENCH_SKILL_DESCRIPTION =
  '这套 ComfyUI 工作台的使用说明：模板 / 变量 / 产物 / 素材四层怎么分工、跑图的标准路径、'
  + '以及三种常见误用（为改参数去改写工作流 JSON、把 UI 格式传给 workflow.path、改产物 sidecar）。'
  + '要驱动 ComfyUI 出图、用姿势或衣装素材拼提示词、或排查产物与复现问题时加载。'

/** 宿主 skill 注册面的最小形状（只用到 register）。 */
interface SkillRegistryLike {
  register?: (skill: { name: string; description: string; content: string; source: string }) => unknown
}

/**
 * 注册（幂等，宿主没挂 skill 服务时静默跳过）。
 *
 * 拿不到 `skills` 服务不算失败：插件的面板与工具都不依赖它，只是模型少了这份说明。
 * 重载时同名已被注册，宿主会记一条 warning 后忽略这次 —— 不抛错，所以这里不做额外处理。
 *
 * **`source` 必须给**。注册时宿主不校验它，但加载时 `validateDefinition` 要求它是字符串，
 * 缺了会在模型真正加载 skill 的那一刻抛 `loaded skill "…" source must be a string` ——
 * 现象是"目录里看得见、一点开就报错"，比没注册更糟。`runtime` 是宿主保留给
 * `ctx.skills.register` 的默认 provider 名，这里显式声明成自己的来源。
 *
 * @param ctx - 宿主上下文。
 */
export function mountWorkbenchSkill(ctx: HostContext): void {
  const skills = ctx.get?.('skills') as SkillRegistryLike | undefined
  if (skills?.register === undefined) return
  try {
    skills.register({
      name: WORKBENCH_SKILL_NAME,
      description: WORKBENCH_SKILL_DESCRIPTION,
      content: skillBody,
      source: 'plugin:dsh-comfyui-workbench',
    })
  } catch {
    // 宿主版本不认这个形状（或同名冲突）时，别让它带崩整条 entry
  }
}
