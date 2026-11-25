/**
 * 交付物登记（`deliverables/presented`）。
 *
 * 这条链路错了不会报错，只会"对话里那张卡片底下什么都没有"——最难发现的一类。
 * 所以把三条硬约束逐条钉住（照抄宿主 `tool-present` 的实现）：
 * 1. 必须 `openTurnStartSeq !== null`（回合已关闭时写入的交付物没人渲染）；
 * 2. `turn` 用 `turnBoundary.lastTurn`，不是自己数；
 * 3. 宿主没有 `sessionProjections` 时整体缺席，且**绝不抛错**。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const { createDeliverablesPresenter } = await import('../lib/index.js')

/** 造一个最小 session：记录 append 调用。 */
function fakeSession() {
  const calls = []
  return {
    calls,
    session: { append: (type, payload) => calls.push({ type, payload }) },
  }
}

/** 造一个最小 ctx：`get('sessionProjections')` 返回给定服务。 */
function fakeCtx(projections) {
  return { get: name => (name === 'sessionProjections' ? projections : undefined) }
}

test('createDeliverablesPresenter：宿主没有 sessionProjections 时整体缺席', () => {
  assert.equal(createDeliverablesPresenter(fakeCtx(undefined)), undefined)
  assert.equal(createDeliverablesPresenter(fakeCtx({})), undefined, '没有 stateOf 也算缺席')
  assert.equal(
    createDeliverablesPresenter({ get: () => { throw new Error('service gone') } }),
    undefined,
    '探测失败要降级成缺席而不是抛错',
  )
})

test('createDeliverablesPresenter：有 open turn 时按宿主形状写入', () => {
  const { calls, session } = fakeSession()
  const presenter = createDeliverablesPresenter(fakeCtx({
    stateOf: () => ({ lastTurn: 7, openTurnStartSeq: 42 }),
  }))
  assert.ok(presenter)

  presenter({ session }, [{ path: 'D:/out/a.png' }, { path: 'D:/out/b.mp4', description: '视频' }], 'call-1')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].type, 'deliverables/presented')
  assert.deepEqual(calls[0].payload, {
    turn: 7,
    callId: 'call-1',
    files: [{ path: 'D:/out/a.png' }, { path: 'D:/out/b.mp4', description: '视频' }],
  })
})

test('createDeliverablesPresenter：回合已关闭（openTurnStartSeq=null）时不写', () => {
  const { calls, session } = fakeSession()
  const presenter = createDeliverablesPresenter(fakeCtx({
    stateOf: () => ({ lastTurn: 7, openTurnStartSeq: null }),
  }))
  presenter({ session }, [{ path: 'D:/out/a.png' }], 'call-1')
  assert.equal(calls.length, 0, '关掉的回合里写交付物只会污染 durable log')
})

test('createDeliverablesPresenter：没有 agent / session / append 时静默跳过', () => {
  const presenter = createDeliverablesPresenter(fakeCtx({
    stateOf: () => ({ lastTurn: 1, openTurnStartSeq: 2 }),
  }))
  assert.doesNotThrow(() => presenter(undefined, [{ path: 'a' }]))
  assert.doesNotThrow(() => presenter({}, [{ path: 'a' }]))
  assert.doesNotThrow(() => presenter({ session: {} }, [{ path: 'a' }]))
  assert.doesNotThrow(() => presenter({ session: { append: () => { throw new Error('boom') } } }, [{ path: 'a' }]))
})

test('createDeliverablesPresenter：空产物列表不写、无 callId 时不带该字段', () => {
  const { calls, session } = fakeSession()
  const presenter = createDeliverablesPresenter(fakeCtx({
    stateOf: () => ({ lastTurn: 3, openTurnStartSeq: 9 }),
  }))

  presenter({ session }, [])
  assert.equal(calls.length, 0, '没有产物就没必要写一条空交付物')

  presenter({ session }, [{ path: 'D:/out/a.png' }])
  assert.equal(calls.length, 1)
  assert.equal('callId' in calls[0].payload, false, '没有 callId 时不该塞一个 undefined 进去')
})
