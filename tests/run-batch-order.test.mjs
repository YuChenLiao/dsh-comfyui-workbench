/**
 * 批量提交的执行顺序。
 *
 * ComfyUI 的权重按"上次用的那份"常驻显存：同工作流连续跑只换 seed 不会重载，
 * 但 `SDXL → Flux → SDXL` 来回切，每次都要重载几十秒。所以提交前要把同工作流的
 * 条目排在一起。
 *
 * 这里只测顺序，不测提交本身（那由 run-batch.test.mjs 覆盖）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { planOrder } from '../lib/index.js'

test('交替的工作流会被聚成两组', () => {
  // A, B, A, B, A → 实际提交 A,A,A,B,B
  const raw = [
    { workflow: { id: 'A' } },
    { workflow: { id: 'B' } },
    { workflow: { id: 'A' } },
    { workflow: { id: 'B' } },
    { workflow: { id: 'A' } },
  ]
  assert.deepEqual(planOrder(raw, undefined), [0, 2, 4, 1, 3])
})

test('组内保持调用方给的相对顺序', () => {
  const raw = [
    { workflow: { id: 'A' }, vars: { i: 0 } },
    { workflow: { id: 'B' }, vars: { i: 1 } },
    { workflow: { id: 'A' }, vars: { i: 2 } },
  ]
  const order = planOrder(raw, undefined)
  // A 组是 0,2；B 组是 1
  assert.deepEqual(order, [0, 2, 1])
})

test('组间按首次出现的顺序', () => {
  const raw = [
    { workflow: { id: 'B' } },
    { workflow: { id: 'A' } },
    { workflow: { id: 'B' } },
  ]
  // B 先出现，所以 B 组在前
  assert.deepEqual(planOrder(raw, undefined), [0, 2, 1])
})

test('单工作流批量：顺序不变', () => {
  const raw = [{ vars: {} }, { vars: {} }, { vars: {} }]
  assert.deepEqual(planOrder(raw, { id: 'same' }), [0, 1, 2])
})

test('外层共用工作流 + 条目各自覆盖', () => {
  const raw = [
    { vars: {} },                       // 用外层 A
    { workflow: { id: 'B' } },          // 覆盖成 B
    { vars: {} },                       // 用外层 A
  ]
  // A 组 0,2；B 组 1
  assert.deepEqual(planOrder(raw, { id: 'A' }), [0, 2, 1])
})

test('path 声明按规范化路径分组（同一文件不同写法算一组）', () => {
  const raw = [
    { workflow: { path: 'D:/wf/a.json' } },
    { workflow: { path: 'D:/wf/b.json' } },
    { workflow: { path: 'D:/wf/./a.json' } },
  ]
  // 第 1 与第 3 指向同一文件 → 同组
  assert.deepEqual(planOrder(raw, undefined), [0, 2, 1])
})

test('空列表', () => {
  assert.deepEqual(planOrder([], { id: 'A' }), [])
})

test('全都不声明工作流时保持原序', () => {
  // 没有 workflow 也没外层 → 都落到 default 组
  assert.deepEqual(planOrder([{}, {}, {}], undefined), [0, 1, 2])
})
