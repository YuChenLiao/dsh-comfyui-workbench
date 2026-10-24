#!/usr/bin/env node
/**
 * 真实环境验收：对着跑着的 DSH + ComfyUI 逐条打勾。
 *
 *   node scripts/acceptance.mjs [--gui http://127.0.0.1:8994] [--comfy http://127.0.0.1:8188] [--run]
 *
 * 与 `npm test` 的分工：单元测试验逻辑，这个验"装进真实宿主后还能不能用"。
 * 默认不触发真实出图（慢），加 `--run` 才跑一次完整的异步出图。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}
const GUI = argOf('--gui', 'http://127.0.0.1:8994').replace(/\/+$/, '')
const COMFY = argOf('--comfy', 'http://127.0.0.1:8188').replace(/\/+$/, '')
const withRun = argv.includes('--run')

const API = `${GUI}/comfyui-workbench/api`
const dataDir = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh-comfyui-workbench')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail === '' ? '' : `　${detail}`}`)
}

/** 取 JSON，返回 { status, body }。 */
async function getJson(url) {
  const res = await fetch(url)
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

async function run() {
  // ── 1. 插件已加载 ──
  const config = await getJson(`${API}/config`)
  check('插件已加载（GET /config）', config.status === 200 && config.body?.ok === true,
    config.status === 200 ? `outputDir=${config.body.config.outputDir}` : `HTTP ${config.status}`)

  const service = await getJson(`${API}/service`)
  check('服务状态可查（GET /service）', service.status === 200 && typeof service.body?.service?.state === 'string',
    `state=${service.body?.service?.state} managed=${service.body?.service?.managed}`)

  // ── 2. 根目录 ──
  const roots = await getJson(`${API}/roots`)
  const rootList = Array.isArray(roots.body?.roots) ? roots.body.roots : []
  const kinds = new Set(rootList.map(root => root.kind))
  check('根目录含 uploads / outputs', kinds.has('upload') && kinds.has('output'),
    `${rootList.length} 个根：${[...kinds].join(', ')}`)

  // ── 3. 资产列表 ──
  const items = await getJson(`${API}/items?limit=5&refresh=1`)
  const first = items.body?.items?.[0]
  check('资产列表可用', items.status === 200 && Array.isArray(items.body?.items) && items.body.items.length > 0,
    `${items.body?.items?.length ?? 0} 条（total ${items.body?.total ?? 0}）`)

  if (first === undefined) {
    console.log('\n没有产物可继续验，先跑一次生成。')
    return
  }

  // ── 4. 元数据 ──
  const meta = await getJson(`${API}/meta?path=${encodeURIComponent(first.path)}`)
  const metaOk = meta.status === 200 && typeof meta.body?.meta === 'object'
  check('单图元数据（GET /meta）', metaOk,
    metaOk ? `prompt=${String(meta.body.meta.prompt ?? '').slice(0, 30)}… seed=${meta.body.meta.seed ?? '-'}` : `HTTP ${meta.status}`)

  // ── 5. 字节与缩略图 ──
  const fileRes = await fetch(`${API}/file?path=${encodeURIComponent(first.path)}`)
  const contentType = fileRes.headers.get('content-type') ?? ''
  const bytes = (await fileRes.arrayBuffer()).byteLength
  check('图片字节（GET /file）', fileRes.ok && bytes > 1000 && contentType.startsWith('image/'),
    `${Math.round(bytes / 1024)} KB · ${contentType}`)

  const thumbRes = await fetch(`${API}/file?thumb=1&path=${encodeURIComponent(first.path)}`)
  const thumbType = thumbRes.headers.get('content-type') ?? ''
  check('缩略图（?thumb=1）', thumbRes.ok && (await thumbRes.arrayBuffer()).byteLength > 0,
    `${thumbType || '无 content-type'}（没有 sharp 时回退原图，也算通过）`)

  // ── 6. 越权与错误语义 ──
  const forbidden = await fetch(`${API}/file?path=${encodeURIComponent('C:/Windows/win.ini')}`)
  check('越权路径被拒（403）', forbidden.status === 403, `HTTP ${forbidden.status}`)

  const unknown = await fetch(`${API}/nope`)
  check('未知路由 404', unknown.status === 404, `HTTP ${unknown.status}`)

  const badMethod = await fetch(`${API}/delete?path=${encodeURIComponent(first.path)}`)
  check('只读接口拒绝写方法（405）', badMethod.status === 405, `HTTP ${badMethod.status}`)

  // ── 7. 工作流 ──
  const workflows = await getJson(`${API}/workflows`)
  const wfList = Array.isArray(workflows.body?.workflows) ? workflows.body.workflows : []
  check('工作流列表', workflows.status === 200 && wfList.length > 0,
    `${wfList.length} 个，含模型名的 ${wfList.filter(item => item.model !== '').length} 个`)

  const sample = wfList.find(item => item.description !== '') ?? wfList[0]
  const detail = sample === undefined ? { status: 0 } : await getJson(`${API}/workflows/${encodeURIComponent(sample.workflowId)}`)
  const inputs = detail.body?.surface?.inputs ?? []
  check('工作流详情（IO 面）', detail.status === 200 && inputs.length > 0,
    sample === undefined ? '没有工作流' : `${sample.workflowId}：${inputs.length} 个输入，${inputs.filter(slot => slot.group === 'basic').length} 个常用`)

  const missingWf = await fetch(`${API}/workflows/__nope__`)
  check('不存在的工作流 404', missingWf.status === 404, `HTTP ${missingWf.status}`)

  // 模型缺失检测：本机没有 sd_xl_base_1.0，示例工作流应当报出来
  const basic = wfList.find(item => item.workflowId === 'text2img-basic')
  check('缺失模型检测', basic === undefined || Array.isArray(basic.missingModels),
    basic === undefined ? '（没有 text2img-basic，跳过）' : `missing=${JSON.stringify(basic.missingModels ?? [])}`)

  // ── 8. 索引 ──
  const assets = await getJson(`${API}/assets?limit=5`)
  check('资产索引（GET /assets）', assets.status === 200 && Array.isArray(assets.body?.items),
    `${assets.body?.items?.length ?? 0} 条`)

  const filtered = await getJson(`${API}/assets?limit=5&workflow=${encodeURIComponent('moss-image_图生图')}`)
  check('索引按工作流过滤', filtered.status === 200 && Array.isArray(filtered.body?.items),
    `${filtered.body?.items?.length ?? 0} 条命中`)

  // ── 9. 上传 ──
  const pngPath = path.join(dataDir, 'outputs', path.basename(first.path))
  const uploadBody = fs.readFileSync(pngPath)
  const upload = await fetch(`${API}/upload?filename=${encodeURIComponent('验收-上传.png')}`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: uploadBody,
  })
  const uploadJson = await upload.json().catch(() => null)
  const uploadedOk = upload.ok && uploadJson?.ok === true && typeof uploadJson.path === 'string' && fs.existsSync(uploadJson.path)
  check('上传（二进制直传）', uploadedOk,
    uploadedOk ? `${path.basename(uploadJson.path)} · ${uploadJson.width}×${uploadJson.height}` : `HTTP ${upload.status}`)

  const badUpload = await fetch(`${API}/upload?filename=x.png`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('not an image'),
  })
  check('上传非图片被拒', badUpload.status === 400, `HTTP ${badUpload.status}`)

  // ── 10. 真实出图（可选）──
  if (!withRun) {
    console.log('\n（跳过真实出图；加 --run 会完整跑一次异步任务）')
    return
  }

  const target = wfList.find(item => item.workflowId === 'moss-image_图生图') ?? wfList[0]
  if (target === undefined) return

  const targetDetail = await getJson(`${API}/workflows/${encodeURIComponent(target.workflowId)}`)
  const imageSlot = (targetDetail.body?.surface?.inputs ?? []).find(slot => slot.type === 'image')
  const reference = path.join(dataDir, 'uploads', fs.readdirSync(path.join(dataDir, 'uploads')).find(name => name.endsWith('.jpg')) ?? '')
  const vars = {
    steps: 20,
    denoise: 0.6,
    seed: 20261024,
    prompt: 'a quiet summer afternoon, anime illustration, soft sunlight',
    ...(imageSlot === undefined ? {} : { [imageSlot.name]: reference }),
  }

  const submit = await fetch(`${API}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowId: target.workflowId, vars }),
  })
  const submitted = await submit.json().catch(() => null)
  check('异步提交（POST /run 立即返回）', submitted?.ok === true && submitted?.pending === true && typeof submitted.promptId === 'string',
    submitted?.promptId ?? `HTTP ${submit.status}`)

  if (typeof submitted?.promptId !== 'string') return

  const startedAt = Date.now()
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    const poll = await fetch(`${API}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ promptId: submitted.promptId }),
    })
    const state = await poll.json().catch(() => null)
    if (state?.pending !== true) {
      const ok = state?.ok === true && Array.isArray(state.artifacts) && state.artifacts.length > 0
      check('续查取回产物（POST /run {promptId}）', ok,
        ok ? `${state.artifacts.length} 个产物 · ${Math.round((Date.now() - startedAt) / 1000)} 秒` : JSON.stringify(state).slice(0, 120))
      if (ok) console.log(`   首个产物：${state.artifacts[0].path}`)
      break
    }
    if (Date.now() - startedAt > 8 * 60 * 1000) {
      check('续查取回产物（POST /run {promptId}）', false, '等了 8 分钟仍未完成')
      break
    }
  }
}

await run()

const failed = results.filter(item => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length === 0 ? '' : `，${failed.length} 项失败`}`)
if (failed.length > 0) {
  for (const item of failed) console.log(`  ✗ ${item.name}：${item.detail}`)
  process.exit(1)
}
