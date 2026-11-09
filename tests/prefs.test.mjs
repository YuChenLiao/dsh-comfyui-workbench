/**
 * 本机偏好持久化。
 *
 * 起因：隐藏 NSFW 是组件内的 `useState`，切到别的面板再切回来，组件被卸载 → 开关重置成
 * "显示"，在有人路过时很容易社死。这类开关必须记住。
 *
 * 这些用例把 `globalThis.window.localStorage` 换成假的，覆盖三种现实情况：能读写、
 * 第一次（没存过）、localStorage 直接抛（隐私模式 / 被策略禁用）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readPref, writePref } from '../lib/index.js'

const PREFIX = 'dsh-comfyui-workbench:'

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    store: data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}

function withWindow(localStorage, run) {
  const previous = globalThis.window
  globalThis.window = localStorage === undefined ? undefined : { localStorage }
  try {
    return run()
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

test('没有存过时用默认值，不把默认值写进存储', () => {
  const storage = fakeStorage()
  withWindow(storage, () => {
    assert.equal(readPref('gallery.hideNsfw', false), false)
    assert.equal(readPref('gallery.hideNsfw', true), true)
  })
  assert.equal(storage.store.size, 0, '读不该产生写入')
})

test('写入后读得回来，且带命名空间前缀', () => {
  const storage = fakeStorage()
  withWindow(storage, () => {
    writePref('gallery.hideNsfw', true)
    assert.equal(readPref('gallery.hideNsfw', false), true)
    writePref('gallery.hideNsfw', false)
    assert.equal(readPref('gallery.hideNsfw', true), false)
  })
  assert.equal(storage.store.get(PREFIX + 'gallery.hideNsfw'), '0')
  assert.equal(storage.store.has('gallery.hideNsfw'), false, '不该写无前缀的裸键')
})

test('localStorage 抛错时读拿默认值、写不抛', () => {
  const hostile = {
    getItem: () => { throw new Error('SecurityError') },
    setItem: () => { throw new Error('QuotaExceededError') },
  }
  withWindow(hostile, () => {
    assert.equal(readPref('gallery.hideNsfw', true), true, '读失败退回默认值')
    assert.doesNotThrow(() => writePref('gallery.hideNsfw', true), '存不下也不能打断操作')
  })
})

test('根本没有 window（服务端/测试环境）时不崩', () => {
  withWindow(undefined, () => {
    assert.equal(readPref('gallery.hideNsfw', false), false)
    assert.doesNotThrow(() => writePref('gallery.hideNsfw', true))
  })
})

test('存进来的值不是 0/1 时按默认值处理', () => {
  const storage = fakeStorage({ [`${PREFIX}gallery.hideNsfw`]: 'yes' })
  withWindow(storage, () => {
    assert.equal(readPref('gallery.hideNsfw', false), false)
    assert.equal(readPref('gallery.hideNsfw', true), true)
  })
})
