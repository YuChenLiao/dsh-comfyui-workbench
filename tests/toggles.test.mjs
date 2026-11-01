/**
 * 面板开关（`settings.json`）：readToggles / writeToggles / effectiveProgressStream。
 *
 * 这些开关是「面板上直接点」的那一类，与 `Settings`（启动时从 profile 解析的快照）
 * 分开：改了它不用重启，下一次提交就生效。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// 必须在 import lib 之前隔离主目录，否则会读写真实的 ~/.dsh-comfyui-workbench
const isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-toggles-'))
process.env.USERPROFILE = isoHome
process.env.HOME = isoHome

const {
  effectiveProgressStream,
  readToggles,
  resetToggleCache,
  togglesPath,
  writeToggles,
} = await import('../lib/index.js')

/** 每次都从干净状态开始。 */
function reset() {
  resetToggleCache()
  try {
    fs.rmSync(togglesPath(), { force: true })
  } catch {
    // 没有就算了
  }
  resetToggleCache()
}

test('没有文件时读成空对象（调用方回退到配置默认值）', () => {
  reset()
  assert.deepEqual(readToggles(), {})
})

test('写入后能读回，且落在数据目录的 settings.json', () => {
  reset()
  const written = writeToggles({ progressStream: true })
  assert.deepEqual(written, { progressStream: true })
  assert.equal(fs.existsSync(togglesPath()), true, '要真的落盘')
  // 缓存被 write 自己失效，所以这里读到的是盘上的值
  assert.deepEqual(readToggles(), { progressStream: true })

  const raw = JSON.parse(fs.readFileSync(togglesPath(), 'utf8'))
  assert.deepEqual(raw, { progressStream: true })
})

test('传 null 删掉覆盖，回退到配置默认值', () => {
  reset()
  writeToggles({ progressStream: false })
  assert.deepEqual(readToggles(), { progressStream: false })

  writeToggles({ progressStream: null })
  assert.deepEqual(readToggles(), {}, 'null 要把这一项删掉，而不是写一个 null')
})

test('坏 JSON 当作没有覆盖，不抛', () => {
  reset()
  fs.writeFileSync(togglesPath(), '{ not json', 'utf8')
  resetToggleCache()
  assert.deepEqual(readToggles(), {}, '一个坏掉的 settings.json 不该让 /run 提交失败')
})

test('不认识的字段与非布尔值一律忽略', () => {
  reset()
  fs.writeFileSync(togglesPath(), JSON.stringify({ progressStream: 'yes', other: true }), 'utf8')
  resetToggleCache()
  assert.deepEqual(readToggles(), {}, '只认布尔值')
})

test('外部改文件后立刻能读到（没有会跨 bundle 分裂的模块级缓存）', () => {
  // `/config` 在 lib/index.js、`/run` 在 lib/entries/workflow.js，本模块被各内联一份。
  // 只要留了模块级缓存，面板写入就只能失效自己那份，另一份要等 TTL ——
  // 症状是「面板显示已开、下一次运行却没有 progress」。所以读取必须是读盘。
  reset()
  writeToggles({ progressStream: false })
  fs.writeFileSync(togglesPath(), JSON.stringify({ progressStream: true }), 'utf8')
  assert.deepEqual(readToggles(), { progressStream: true }, '读到的是盘上的值，不能是缓存')
})

test('写入保留不认识的键（以后加新开关时不会被旧代码抹掉）', () => {
  reset()
  fs.writeFileSync(togglesPath(), JSON.stringify({ progressStream: false, future: 'keep-me' }), 'utf8')
  writeToggles({ progressStream: true })
  const raw = JSON.parse(fs.readFileSync(togglesPath(), 'utf8'))
  assert.equal(raw.future, 'keep-me', '未知键要原样保留')
  assert.equal(raw.progressStream, true)
})

test('有效值：面板开关 > 配置默认值', () => {
  assert.equal(effectiveProgressStream({ progressStream: false }, {}), false, '没覆盖时用配置')
  assert.equal(effectiveProgressStream({ progressStream: false }, { progressStream: true }), true, '面板开了就开')
  assert.equal(effectiveProgressStream({ progressStream: true }, { progressStream: false }), false, '面板关了也按面板')
})
