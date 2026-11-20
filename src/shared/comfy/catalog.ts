/**
 * 本机模型盘点：按类别列出 `/object_info` 里各 loader 认可的权重。
 *
 * ## 为什么不复用 `availableModels`
 *
 * 那个函数返回的是一个**扁平集合**，只够回答"这个模型本机有没有"。而"我有哪些 LoRA"
 * 要的是分类 —— 同一个 `lora_name` 的候选和 `ckpt_name` 的候选混在一起，模型没法用。
 *
 * ## 触发词为什么要单独一份文件
 *
 * LoRA 的触发词不在 `/object_info` 里（那是权重文件自带的元数据，ComfyUI 不暴露），
 * 只能由用户手写。放在插件数据目录的 `loras.json` 而不是模板里：
 * 它跟具体工作流无关，是"这台机器上这个 LoRA 该怎么用"。形状容忍两种：
 *
 * ```json
 * { "my_lora.safetensors": "trigger words here" }
 * { "my_lora.safetensors": { "triggers": "trigger words", "note": "…" } }
 * ```
 *
 * 读失败一律当作"没有备注"：这是可选增强，不该让它把盘点本身弄挂。
 */
import fs from 'node:fs'
import path from 'node:path'

import type { ObjectInfo } from './types.js'

/** 模型类别。`other` 兜住认不出来的那些（自定义 loader 的字段名五花八门）。 */
export type ModelKind = 'checkpoint' | 'lora' | 'vae' | 'controlnet' | 'upscaler' | 'other'

export interface ModelCatalog {
  byKind: Record<ModelKind, string[]>
  /** 各类数量（`other` 为 0 时不出现）。 */
  counts: Record<string, number>
  /** 触发词备注：模型名 → 备注。只包含文件里写过的。 */
  triggers: Record<string, string>
  /** 触发词文件的绝对路径（模型据此告诉用户"想加就去编辑这个"）。 */
  triggerFile: string
  /** 读触发词文件时遇到的问题（解析失败之类）。 */
  triggerError?: string
}

/** 字段名 → 类别。顺序有讲究：先匹配更具体的，`model` 最泛所以放最后。 */
const KIND_RULES: Array<[ModelKind, RegExp]> = [
  ['lora', /lora/i],
  ['vae', /vae/i],
  ['controlnet', /control/i],
  ['upscaler', /upscal|realesrgan|esrgan|swinir/i],
  ['checkpoint', /ckpt|checkpoint|unet|diffusion_model/i],
]

/**
 * 这些字段是**枚举 / 配置**，永远不是"可用模型"。
 *
 * 它们也常是 COMBO（`weight_dtype: ["default","fp8_e4m3fn"]`、
 * `upscale_method: ["nearest-exact","bicubic"]`、`config_name: ["v1-inference.yaml"]`），
 * 而所在节点恰好带关键词（`UNETLoader` / `LatentUpscale`）—— 只看节点类型的话，
 * 精度档位和插值算法会被列成"本机可用的模型"。
 */
const NOT_MODEL_FIELD = /^(sampler|scheduler|clip_skip|seed|steps|cfg)|(dtype|device|upscale_method|method|crop|config_name|precision|format|mode|strength|weight)$/i

/**
 * 字段像不像"一个权重文件名"。
 *
 * 这是收集的**唯一入口**：`*_name` / `*_file` / `*_path`（带序号，如 `clip_name1`）。
 * 真实 loader 的槽位几乎都落在这几种后缀里，而枚举字段（`*_method` / `*_dtype`）
 * 一个都不沾 —— 比"节点类型匹配就全收"稳得多。
 */
function looksLikeModelField(field: string): boolean {
  if (NOT_MODEL_FIELD.test(field)) return false
  return /(_name|_file|_path)\d*$/i.test(field)
}

/**
 * 字段名 + 节点类型 → 类别；认不出来时看字段本身像不像模型名。
 *
 * **两者都要看**：`UpscaleModelLoader` 的字段也叫 `model_name`，只按字段名判断会把它
 * 归进 checkpoint，于是"我有哪些放大模型"列出的是 checkpoint。节点类型带着用途信息，
 * 字段名带着槽位信息，合起来才够。
 *
 * 认不出类别的 loader（`InstantIDModelLoader.instantid_file`、
 * `IPAdapterModelLoader.ipadapter_file`、`GLIGENLoader.gligen_name`）字段本身仍是
 * `*_file` / `*_name`，所以进 `other` 而不是消失。
 */
function kindOf(nodeType: string, field: string): ModelKind | undefined {
  if (looksLikeModelField(field) === false) return undefined
  const combined = `${nodeType} ${field}`
  for (const [kind, pattern] of KIND_RULES) {
    if (pattern.test(combined)) return kind
  }
  return 'other'
}

/** 读触发词备注（可选文件）。 */
export function readTriggers(file: string): { triggers: Record<string, string>; error?: string } {
  if (fs.existsSync(file) === false) return { triggers: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return {
      triggers: {},
      error: `触发词文件不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { triggers: {}, error: '触发词文件应该是一个对象：{"模型名": "触发词"}。' }
  }
  const triggers: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    const text = typeof value === 'string'
      ? value
      : value !== null && typeof value === 'object' && typeof (value as { triggers?: unknown }).triggers === 'string'
        ? (value as { triggers: string }).triggers
        : undefined
    if (text !== undefined && text.trim() !== '') triggers[name] = text.trim()
  }
  return { triggers }
}

/**
 * 把 `/object_info` 的模型候选按类别归拢。
 *
 * @param info - `/object_info` 的返回。
 * @param triggerFile - 触发词备注文件路径。
 */
export function catalogModels(info: ObjectInfo, triggerFile: string): ModelCatalog {
  const byKind: Record<ModelKind, Set<string>> = {
    checkpoint: new Set(),
    lora: new Set(),
    vae: new Set(),
    controlnet: new Set(),
    upscaler: new Set(),
    other: new Set(),
  }

  for (const [nodeType, node] of Object.entries(info)) {
    for (const bag of [node.input?.required, node.input?.optional]) {
      if (bag === undefined || bag === null) continue
      for (const [field, decl] of Object.entries(bag)) {
        // 只认 COMBO（候选值数组），手填路径的字符串字段不算"本机可用"
        if (Array.isArray(decl) === false || Array.isArray(decl[0]) === false) continue
        // 字段必须像模型槽位：枚举/配置类的 COMBO 在这一步就出局
        const kind = kindOf(nodeType, field)
        if (kind === undefined) continue
        for (const candidate of decl[0]) {
          if (typeof candidate === 'string' && candidate.trim() !== '') byKind[kind].add(candidate)
        }
      }
    }
  }

  const sorted: Record<ModelKind, string[]> = {
    checkpoint: [...byKind.checkpoint].sort(),
    lora: [...byKind.lora].sort(),
    vae: [...byKind.vae].sort(),
    controlnet: [...byKind.controlnet].sort(),
    upscaler: [...byKind.upscaler].sort(),
    other: [...byKind.other].sort(),
  }
  const counts: Record<string, number> = {}
  for (const [kind, list] of Object.entries(sorted)) {
    if (list.length > 0) counts[kind] = list.length
  }

  const { triggers, error } = readTriggers(triggerFile)
  return {
    byKind: sorted,
    counts,
    triggers,
    triggerFile,
    ...(error === undefined ? {} : { triggerError: error }),
  }
}
