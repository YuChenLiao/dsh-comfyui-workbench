/** 工作流文件格式。 */
export type WorkflowFormat = 'api' | 'ui' | 'invalid'

/**
 * 判定一份 JSON 是 API 格式还是 UI 格式。
 *
 * 只有 API 格式能直接 `POST /prompt`：UI 格式（`nodes` + `links` + `widgets_values`）
 * 是 ComfyUI 界面自己的工程文件，要提交必须先做图转换。v0.1 不做转换 ——
 * 与其猜错，不如让用户重新导出。
 *
 * @param value - 解析后的 JSON。
 */
export function detectFormat(value: unknown): WorkflowFormat {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'invalid'
  const bag = value as Record<string, unknown>

  // UI 格式的特征：nodes 数组 + links 数组，节点带 widgets_values。
  if (Array.isArray(bag.nodes) && Array.isArray(bag.links)) return 'ui'

  const entries = Object.entries(bag)
  if (entries.length === 0) return 'invalid'

  let nodeLike = 0
  for (const [, node] of entries) {
    if (node === null || typeof node !== 'object') continue
    const candidate = node as { class_type?: unknown; inputs?: unknown }
    if (typeof candidate.class_type === 'string' && candidate.inputs !== null && typeof candidate.inputs === 'object') {
      nodeLike += 1
    }
  }
  return nodeLike > 0 && nodeLike === entries.length ? 'api' : 'invalid'
}

/** 格式不对时给用户的说明（含具体操作指引）。 */
export function formatHint(format: WorkflowFormat): string {
  if (format === 'ui') {
    return '这是 ComfyUI 界面的工程文件（UI 格式），不能直接提交。请在 ComfyUI 里用「Export (API)」重新导出后再导入。'
  }
  return '这不是可识别的 API 格式工作流：需要形如 {"3": {"class_type": "KSampler", "inputs": {...}}} 的 JSON。'
}
