/**
 * 衣装面板的两个易错点，都是"看起来接好了、实际没生效"：
 *
 * 1. **切画风后图没换** —— 列表数据按 source 换了，但图片 URL 没带 source，
 *    服务端回退到写实版同号图。这是第一版真踩过的 bug。
 * 2. **筛选区滚走** —— 大列表翻到下面还想换分类/画风时，得滚回去找。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const ROOT = 'D:/dsh/dsh-comfyui-workbench'

test('图片 URL 必须带 source —— 否则切到二次元后图还是写实版的', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/client/api.ts'), 'utf8')

  // costumeImageUrl 要有 source 参数并拼进查询串
  assert.match(api, /export function costumeImageUrl\([^)]*source\?: CostumeSource\)/, 'costumeImageUrl 必须接 source')
  assert.match(api, /source === 'anime' \? '&source=anime' : ''/, '要把 source 拼进 URL')

  // fetchCostumeFile 同理
  assert.match(api, /export async function fetchCostumeFile\([^)]*source\?: CostumeSource\)/, 'fetchCostumeFile 必须接 source')
  assert.match(api, /source === 'anime' \? \{ id, size, source: 'anime' \} : \{ id, size \}/, '落盘请求要带 source')

  // 面板里调这两处都必须传 source（漏一个就会出现"部分图没换"）
  const panel = fs.readFileSync(path.join(ROOT, 'src/components/panel-costumes/client/CostumesPanel.tsx'), 'utf8')
  const calls = [...panel.matchAll(/costumeImageUrl\(([^)]*)\)|fetchCostumeFile\(([^)]*)\)/g)]
  assert.ok(calls.length >= 3, `面板里该有三处取图调用，实际 ${calls.length}`)
  for (const call of calls) {
    const args = call[1] ?? call[2]
    assert.match(args, /source/, `这一处漏了 source：${call[0]}`)
  }
})

test('筛选区吸顶：sticky + 抵消滚动容器的 padding', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/components/panel-costumes/client/styles.css'), 'utf8')
  const rule = /\.cct-search\{([^}]*)\}/.exec(css)

  assert.ok(rule !== null, '找不到 .cct-search 规则')
  const body = rule[1]

  assert.match(body, /position:sticky/, '筛选区要吸顶')
  // .cct-root 的 padding 是 14px/20px —— 不抵消的话卡片会从 padding 区透出来
  assert.match(body, /top:-14px/, 'top 要抵消 .cct-root 的 padding-top')
  assert.match(body, /margin:0 -20px/, '左右要抵消 .cct-root 的 padding')
  assert.match(body, /background:var\(--w-bg\)/, '背景必须实色，否则卡片会透出来')
})

test('.cct-root 的 padding 与吸顶用的负偏移必须对得上', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/components/panel-costumes/client/styles.css'), 'utf8')
  const rootRule = /\.cct-root\{([^}]*)\}/.exec(css)
  assert.ok(rootRule !== null)
  const padding = /padding:(\d+)px (\d+)px/.exec(rootRule[1])
  assert.ok(padding !== null, '.cct-root 的 padding 形式变了？')
  const [, vertical, horizontal] = padding

  const search = /\.cct-search\{([^}]*)\}/.exec(css)[1]
  assert.ok(search.includes(`top:-${vertical}px`), `.cct-root 的 padding-top 是 ${vertical}px，吸顶要写 top:-${vertical}px`)
  assert.ok(search.includes(`margin:0 -${horizontal}px`), `.cct-root 的左右 padding 是 ${horizontal}px，吸顶要抵消它`)
})
