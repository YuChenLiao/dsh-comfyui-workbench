/**
 * 资产库扫描的性能与截断语义。
 *
 * 背景：一个塞满语音素材的工作区（19 万文件 / 11 万媒体）打开面板要 27 秒，
 * 连测三次都没有缓存效果。根因有三条，这里逐条钉住：
 *
 * 1. 每个媒体文件先 `statSync` 再 `existsSync`，而其中绝大多数最后都被上限丢掉；
 * 2. sidecar 判定靠 `existsSync`，而 `readdirSync` 早就把文件名全拿到了；
 * 3. 缓存时间戳取的是**扫描开始**的时刻，慢扫描存进去就已过期。
 *
 * 还有一条不能修的"优化"也钉在这里：不能在目录层按"本目录有没有媒体扩展名"
 * 剪枝 —— 生成图普遍落在 `<workspace>/comfyui-output/2026-11/` 这种父目录只有
 * 子目录的树里，剪掉就把真图全漏了。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const { collectImages, scanRoot, clearScanCache } = await import('../lib/index.js')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const cleanup = []

function makeTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-scan-'))
  cleanup.push(root)
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

const OPTS = { maxDepth: 3, maxItems: 10, includeHidden: false, excludeDirs: [] }

after(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true })
})

// ── 统计 statSync 调用次数：真正的性能指标，不看耗时（CI 上耗时不可靠）──
function countingStats(fn) {
  const original = fs.statSync
  const calls = []
  fs.statSync = (target, ...rest) => {
    calls.push(String(target))
    return original.call(fs, target, ...rest)
  }
  try {
    const value = fn()
    return { value, calls }
  } finally {
    fs.statSync = original
  }
}

test('bare 满额后不再 stat 非 PNG 媒体（wav 目录不再拖慢扫描）', () => {
  const spec = {}
  for (let i = 0; i < 40; i += 1) spec[`voices/track-${i}.wav`] = 'x'
  const root = makeTree(spec)

  const { value, calls } = countingStats(() => collectImages(root, { ...OPTS, maxItems: 5 }))

  assert.equal(value.files.length, 5, '上限仍要生效')
  assert.equal(value.truncatedBare, true, '超出的要标记被截断')
  assert.equal(
    calls.filter(p => p.endsWith('.wav')).length,
    5,
    `只应对收得下的 5 个 wav 做 stat，实际 stat 了 ${calls.length} 次`,
  )
})

test('sidecar 判定走内存集合：不再对每个文件 existsSync', () => {
  const spec = {}
  for (let i = 0; i < 12; i += 1) spec[`out/gen-${i}.png`] = 'x'
  for (let i = 0; i < 6; i += 1) spec[`out/gen-${i}.png.json`] = '{}'
  const root = makeTree(spec)

  const original = fs.existsSync
  let existsCalls = 0
  fs.existsSync = (...args) => {
    existsCalls += 1
    return original.apply(fs, args)
  }
  try {
    const scanned = collectImages(root, { ...OPTS, maxItems: 100 })
    assert.equal(existsCalls, 0, '一次 existsSync 都不该发生 —— 名字集合里已经有了')
    assert.equal(scanned.files.filter(f => f.generated === true).length, 6)
  } finally {
    fs.existsSync = original
  }
})

test('父目录只有子目录时，嵌套生成图不能漏（禁止按目录名剪枝）', () => {
  const root = makeTree({
    'comfyui-output/2026-11/nested.png': 'x',
    'comfyui-output/2026-11/nested.png.json': '{}',
    'voices/a.wav': 'x',
  })

  const scanned = collectImages(root, { ...OPTS, maxItems: 10 })
  const paths = scanned.files.map(f => f.path.replace(/\\/g, '/'))
  assert.equal(
    paths.some(p => p.endsWith('comfyui-output/2026-11/nested.png')),
    true,
    '嵌套在 3 层目录里的生成图必须被收进来',
  )
})

test('excludeDirs 跳过大目录，且不影响其它分支', () => {
  const spec = {
    'huge-material/huge.wav': 'x',
    'huge-material/deep/x.wav': 'x',
    'keep/keep.png': 'x',
  }
  const root = makeTree(spec)

  const scanned = collectImages(root, { ...OPTS, excludeDirs: ['huge-material'] })
  const paths = scanned.files.map(f => f.path.replace(/\\/g, '/'))
  assert.equal(paths.some(p => p.includes('huge-material')), false, '被排除的目录不该产出任何记录')
  assert.equal(paths.some(p => p.endsWith('keep/keep.png')), true, '同级的其它目录照常扫描')
})

test('缓存时间戳取扫描结束时刻：扫描本身比 TTL 还慢时，第二次仍要命中', () => {
  clearScanCache()
  const root = makeTree({ 'a/x.png': 'x', 'a/y.png': 'x' })

  // 假时钟 + 假"扫描耗时"：每读一次目录让时间前进 50ms，TTL 设 40ms。
  // 这样"存开始时刻"与"存结束时刻"才会给出不同结果 —— 真实磁盘上扫描只要几毫秒，
  // 不加这一步的话两种实现在测试里恒等，等于没测。
  const realNow = Date.now
  const realReaddir = fs.readdirSync
  let fake = 1_000_000
  Date.now = () => fake
  fs.readdirSync = (...args) => {
    const value = realReaddir.apply(fs, args)
    fake += 50
    return value
  }
  try {
    const settings = { maxDepth: 2, maxItems: 100, includeHidden: false, cacheMs: 40, excludeDirs: [] }
    const first = scanRoot(root, settings, false)
    const second = scanRoot(root, settings, false)
    assert.equal(second, first, '存结束时刻时应命中原对象；存开始时刻这里会重扫')

    const refreshed = scanRoot(root, settings, true)
    assert.notEqual(refreshed, first, 'force=true 必须重扫')
  } finally {
    Date.now = realNow
    fs.readdirSync = realReaddir
  }
})

test('缓存键包含 excludeDirs：改配置后不能吃到旧结果', () => {
  clearScanCache()
  const root = makeTree({ 'skip/x.png': 'x', 'keep/y.png': 'x' })
  const base = { maxDepth: 2, maxItems: 100, includeHidden: false, cacheMs: 60_000 }

  const all = scanRoot(root, { ...base, excludeDirs: [] }, false)
  const filtered = scanRoot(root, { ...base, excludeDirs: ['skip'] }, false)
  assert.notEqual(filtered, all, 'excludeDirs 不同必须是不同的缓存条目')
  assert.equal(all.files.length, 2)
  assert.equal(filtered.files.length, 1)
})

test('客户端的「刷新」与「出图完成」必须带 refresh=1，否则服务端 force 永远走不到', () => {
  // 这条锁的是接线而不是实现：scanRoot 的 force 分支只有 `?refresh=1` 能触发，
  // 客户端漏了这一个参数，缓存 TTL 就变成"新图看不见"的根因（曾经真出现过）。
  const hook = fs.readFileSync(path.join(ROOT, 'src/components/panel-gallery/client/hooks/useGalleryData.ts'), 'utf8')
  assert.match(hook, /if \(force\) params\.refresh = '1'/, 'load 要把 force 翻成 refresh=1')

  const gallery = fs.readFileSync(path.join(ROOT, 'src/components/panel-gallery/client/Gallery.tsx'), 'utf8')
  assert.match(gallery, /onRefresh=\{\(\) => gallery\.reload\(true, true\)\}/, '刷新按钮要强制重扫')
  assert.match(gallery, /reloadRef\.current\(true, true\)/, '出图完成后的刷新也要强制重扫')
})
