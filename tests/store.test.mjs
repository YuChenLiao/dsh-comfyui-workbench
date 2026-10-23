/**
 * store 域自检：索引的写入、检索、覆盖、重建。
 *
 * 对应验收：
 *   B16 索引可重建 —— 删掉索引后能从 sidecar 长出同样的记录
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { AssetIndex, rebuildFromSidecars } from '../lib/store.js'

function tmpIndex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-store-'))
  return new AssetIndex(path.join(dir, 'assets.jsonl'))
}

function record(overrides = {}) {
  return {
    digest: 'abc123def456',
    path: 'D:/dsh/out/a.png',
    bytes: 1024,
    mime: 'image/png',
    workflowId: 'sdxl',
    workflowHash: 'h1',
    promptId: 'p1',
    createdAt: '2026-10-23T10:00:00.000Z',
    tags: ['test'],
    status: 'present',
    ...overrides,
  }
}

test('写入与检索：按工作流 / 标签 / 类型过滤', () => {
  const index = tmpIndex()
  index.add(record())
  index.add(record({ path: 'D:/dsh/out/b.webp', mime: 'image/webp', workflowId: 'upscale', tags: ['test', 'up'] }))
  index.add(record({ path: 'D:/dsh/out/c.mp4', mime: 'video/mp4', workflowId: 'sdxl' }))

  assert.equal(index.size, 3)
  assert.equal(index.search({ workflow: 'sdxl' }).items.length, 2)
  assert.equal(index.search({ tag: ['up'] }).items.length, 1)
  assert.equal(index.search({ kind: 'image' }).items.length, 2)
  assert.equal(index.search({ kind: 'video' }).items.length, 1)
  assert.equal(index.search({ q: 'b.webp' }).items.length, 1)
})

test('同路径后写为准', () => {
  const index = tmpIndex()
  index.add(record({ status: 'present' }))
  index.add(record({ status: 'archived' }))
  assert.equal(index.size, 1)
  assert.equal(index.all()[0].status, 'archived')
})

test('游标分页与排序', () => {
  const index = tmpIndex()
  const stamps = ['2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z', '2026-10-22T00:00:00Z']
  stamps.forEach((iso, i) => index.add(record({ path: `D:/out/${i}.png`, createdAt: iso })))

  const first = index.search({ limit: 2 })
  assert.equal(first.items.length, 2)
  assert.equal(first.items[0].createdAt, '2026-10-22T00:00:00Z', '默认按时间倒序')
  assert.ok(first.next !== undefined)

  const second = index.search({ limit: 2, cursor: first.next })
  assert.equal(second.items.length, 1)
  assert.equal(second.next, undefined)
})

test('删除与整体重写', () => {
  const index = tmpIndex()
  index.add(record())
  index.add(record({ path: 'D:/out/b.png' }))
  index.remove('D:/out/b.png')
  assert.equal(index.size, 1)

  index.rewrite([record({ path: 'D:/out/c.png' })])
  assert.equal(index.size, 1)
  assert.equal(index.all()[0].path, 'D:/out/c.png')
})

test('坏行跳过而不是整体失败', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-badline-'))
  const file = path.join(dir, 'assets.jsonl')
  const lines = [
    JSON.stringify(record({ path: 'D:/out/a.png' })),
    '{ this is not json',
    JSON.stringify(record({ path: 'D:/out/b.png' })),
    '',
  ]
  fs.writeFileSync(file, lines.join('\n'), 'utf8')

  const index = new AssetIndex(file)
  assert.equal(index.size, 2, '坏行被跳过，好行仍然可用')
  assert.equal(index.search({ q: 'b.png' }).items.length, 1)
})

test('从 sidecar 重建（B16）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-rebuild-'))
  const image = path.join(root, 'a.png')
  fs.writeFileSync(image, Buffer.from('89504e470d0a1a0a', 'hex'))
  fs.writeFileSync(`${image}.json`, JSON.stringify({
    plugin: 'dsh-comfyui-workbench',
    createdAt: '2026-10-23T10:00:00.000Z',
    workflowId: 'sdxl',
    workflowHash: 'h1',
    prompt: 'a lighthouse',
    tags: ['rebuild'],
    comfy: { url: 'http://127.0.0.1:8188', promptId: 'p9' },
  }), 'utf8')

  const records = rebuildFromSidecars([root], { maxDepth: 1, maxItems: 100, includeHidden: false })
  assert.equal(records.length, 1)
  assert.equal(records[0].workflowId, 'sdxl')
  assert.equal(records[0].promptId, 'p9')
  assert.deepEqual(records[0].tags, ['rebuild'])
  assert.equal(records[0].mime, 'image/png')

  const index = tmpIndex()
  index.rewrite(records)
  assert.equal(index.search({ workflow: 'sdxl' }).items.length, 1)
})
