/**
 * 把素材与用户意图拼成一条提示词。
 *
 * 顺序按"信息密度从具体到宽泛"排：服装关键词 → 标签 → 用户的自由描述。
 * 这样模型的注意力先落在主体穿着上，场景描述收尾。
 *
 * **只拼给到的东西**：不自动加 `masterpiece, best quality` 这类质量词 ——
 * 那是模板或用户的事，工具替人决定审美是越界。
 */

export interface PromptParts {
  /** 衣装库的英文关键词串（`ivory frill knit denim mini skirt`）。 */
  keywords?: string | undefined
  /** 已转好的 Danbooru tag。 */
  tags?: readonly string[] | undefined
  /** 用户的自由描述（中文也行，ComfyUI 侧模板自己处理）。 */
  prompt?: string | undefined
}

/**
 * 拼接并去重（大小写不敏感，按逗号段比较）。
 *
 * @param parts - 三段素材。
 */
export function buildPrompt(parts: PromptParts): string {
  const seen = new Set<string>()
  const out: string[] = []

  const push = (raw: string): void => {
    const text = raw.trim().replace(/^,+|,+$/g, '').trim()
    if (text === '') return
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(text)
  }

  if (parts.keywords !== undefined) {
    for (const segment of parts.keywords.split(',')) push(segment)
  }
  for (const tag of parts.tags ?? []) push(tag)
  if (parts.prompt !== undefined) {
    // 自由描述按逗号**切开逐句去重**（整段比对会让"站在窗边，傍晚"没法与已有的"傍晚"合并），
    // 拼回去时顺序不变、分隔符统一成逗号 —— 视觉上仍是一句话，只是重复的小句被剔掉。
    for (const sentence of parts.prompt.split(/[，,]/)) push(sentence)
  }

  return out.join(', ')
}
