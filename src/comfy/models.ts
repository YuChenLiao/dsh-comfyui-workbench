import type { ObjectInfo } from '../comfy/index.js'
import type { ModelRef } from '../workflow/types.js'

/** 模型类输入名：只有这些字段的 COMBO 候选才算"可用模型"。 */
const MODEL_FIELD = /(ckpt|checkpoint|unet|model|lora|vae).*name$/i

/**
 * 从 `/object_info` 里收集本机各 loader 节点认可的模型名。
 *
 * 只收模型类字段的候选值：`sampler_name` 之类的 COMBO 也在 object_info 里，
 * 全收进来就分不清"缺模型"和"缺采样器"了。
 *
 * @param info - `/object_info` 的返回。
 */
export function availableModels(info: ObjectInfo): Set<string> {
  const names = new Set<string>()
  for (const node of Object.values(info)) {
    const bags = [node.input?.required, node.input?.optional]
    for (const bag of bags) {
      if (bag === undefined || bag === null) continue
      for (const [field, decl] of Object.entries(bag)) {
        if (!MODEL_FIELD.test(field)) continue
        // COMBO 的形状是 [[候选值...], {...}]；单个字符串的是"手填路径"，不算候选。
        if (!Array.isArray(decl) || !Array.isArray(decl[0])) continue
        for (const candidate of decl[0]) {
          if (typeof candidate === 'string' && candidate !== '') names.add(candidate)
        }
      }
    }
  }
  return names
}

/**
 * 找出工作流里引用了、但本机没有的模型。
 *
 * 这是"工作流导入了却跑不通"最常见的原因：节点参数里写的是一个这台机器上不存在的
 * 权重名，ComfyUI 会回 `value_not_in_list`。提前报出来，用户才知道该换哪个。
 *
 * @param models - 工作流引用的模型。
 * @param available - 本机可用模型集合。
 */
export function missingModels(models: readonly ModelRef[], available: ReadonlySet<string>): string[] {
  const missing: string[] = []
  for (const model of models) {
    if (model.name === '') continue
    if (available.has(model.name)) continue
    missing.push(model.name)
  }
  return missing
}

/** 给缺失的 checkpoint 挑几个像样的替代（同目录下的优先）。 */
export function suggestModels(available: ReadonlySet<string>, kind: string, limit = 3): string[] {
  const all = [...available]
  if (kind === 'checkpoint') {
    // 优先没有子目录的、非 lora/upscale 的权重
    return all
      .filter(name => /\.(safetensors|ckpt)$/i.test(name) && !/(lora|upscale|vae|realesrgan|control)/i.test(name))
      .slice(0, limit)
  }
  return all.slice(0, limit)
}
