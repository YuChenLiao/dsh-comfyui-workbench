/**
 * 面板"拿这张图去出图"依赖的两条 HTTP 契约。
 *
 * 这两条曾错配，而工具侧的测试全绿：
 * - 面板走 HTTP 路由，用的是**另一份** `toListItem`（workflows-api.ts），
 *   `imageSlots` 只加在工具侧那份上 → 面板永远列不出候选
 * - `?inputs=image` 的形参原来是 `_url`，根本不读 query → 过滤完全无效
 *
 * 所以这里直接打 HTTP handler，不碰工具层。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { handleWorkflowList } from '../lib/index.js'

/** 吃图的工作流。 */
const WITH_IMAGE = {
  1: { class_type: 'LoadImage', inputs: { image: 'x.png' } },
  7: { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'x' } },
}

/** 不吃图的工作流。 */
const NO_IMAGE = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  7: { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'x' } },
}

/** 造工作流目录。 */
function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hwl-'))
  fs.writeFileSync(path.join(dir, 'with-image.json'), JSON.stringify(WITH_IMAGE))
  fs.writeFileSync(path.join(dir, 'no-image.json'), JSON.stringify(NO_IMAGE))
  return dir
}

/** 假的 ServerResponse。 */
function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; return this },
    end(body) { this.body = body },
  }
}

/** 打一次 GET /workflows。 */
async function list(dir, query) {
  const res = fakeRes()
  await handleWorkflowList(dir, new URL(`http://x/workflows${query}`), res, null)
  return JSON.parse(res.body)
}

test('列表项必须带 imageSlots（面板靠它知道往哪个键传图）', async () => {
  const dir = makeDir()
  const data = await list(dir, '')
  assert.equal(data.ok, true)
  for (const item of data.workflows) {
    assert.ok(Array.isArray(item.imageSlots), `${item.workflowId} 缺 imageSlots`)
  }
  const withImage = data.workflows.find(item => item.workflowId === 'with-image')
  assert.deepEqual(withImage.imageSlots, ['image'])
  const noImage = data.workflows.find(item => item.workflowId === 'no-image')
  assert.deepEqual(noImage.imageSlots, [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('?inputs=image 真的过滤（形参不能是 _url）', async () => {
  const dir = makeDir()
  const all = await list(dir, '')
  assert.equal(all.count, 2, '不带筛选要都返回')

  const filtered = await list(dir, '?inputs=image')
  assert.equal(filtered.count, 1, `该只剩吃图的那个，实际 ${filtered.count}`)
  assert.equal(filtered.workflows[0].workflowId, 'with-image')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('筛空时给 hint，不是干巴巴的空数组', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hwl2-'))
  fs.writeFileSync(path.join(dir, 'only-text.json'), JSON.stringify(NO_IMAGE))
  const data = await list(dir, '?inputs=image')
  assert.equal(data.count, 0)
  assert.match(String(data.hint ?? ''), /image/, '提示要提到 image')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('不认的 inputs 值不会误伤（未知类型照常返回空）', async () => {
  const dir = makeDir()
  const data = await list(dir, '?inputs=mask')
  assert.equal(data.count, 0, '没有工作流用 mask 输入')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('大小写不敏感', async () => {
  const dir = makeDir()
  const data = await list(dir, '?inputs=IMAGE')
  assert.equal(data.count, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
