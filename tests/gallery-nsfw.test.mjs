/**
 * NSFW 判定。
 *
 * 这是启发式而非分类器，所以要守的是三件事：强信号单命中即判、中信号要凑两个、
 * 正常图不能被误伤。误伤比漏判更烦 —— 用户不知道为什么少了一张图。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isNsfw, nsfwVerdictOf } from '../lib/index.js'

test('强信号：单命中即判 NSFW', () => {
  assert.equal(isNsfw({ prompt: 'masterpiece, 1girl, nsfw, solo' }), true)
  assert.equal(isNsfw({ prompt: 'best quality, explicit' }), true)
  assert.equal(isNsfw({ prompt: 'hentai style' }), true)
  assert.equal(isNsfw({ name: 'r18_00001_.png' }), true)
  // 中文也认
  assert.equal(isNsfw({ prompt: '一个女孩，裸体' }), true)
})

test('中信号：要凑够两个才判', () => {
  // 只看一个不算 —— 泳装、解剖练习里都有
  assert.equal(isNsfw({ prompt: 'nude' }), false)
  assert.equal(isNsfw({ prompt: 'breasts' }), false)
  // 两个就算
  assert.equal(isNsfw({ prompt: 'nude, breasts' }), true)
  assert.equal(isNsfw({ prompt: 'topless with lingerie' }), true)
})

test('正常图不误伤', () => {
  const normal = [
    'masterpiece, best quality, 1girl, blue hair, school uniform, city street',
    'landscape, mountains, sunset, highly detailed',
    'anime style, cel shading, blue archive, halo',
    'cat, sitting, sunny day',
  ]
  for (const prompt of normal) {
    assert.equal(isNsfw({ prompt }), false, `不该判成 NSFW：${prompt}`)
  }
})

test('扫的字段：名字、正向提示词、底模、工作流 id', () => {
  assert.equal(isNsfw({ name: 'nsfw_test.png' }), true)
  assert.equal(isNsfw({ checkpoint: 'animaginexl4-nsfw.safetensors' }), true)
  assert.equal(isNsfw({ workflowId: 'nsfw-txt2img' }), true)
})

test('负向提示词不参与判定', () => {
  // Danbooru 系底模（AnimagineXL / Pony）的官方推荐负向模板里就写着 nsfw。
  // 拿它判定会让用户一整库图都被藏掉 —— 而那正是在"排除"成人内容。
  assert.equal(isNsfw({ prompt: 'a cat', negativePrompt: 'nsfw, bad anatomy' }), false)
  assert.equal(isNsfw({ prompt: 'masterpiece, 1girl', negativePrompt: 'nsfw, worst quality' }), false)
})

test('词根覆盖复数：存的是词根，匹配是子串', () => {
  // 曾经存成复数（breasts/nipples），于是单数全漏
  assert.equal(isNsfw({ prompt: 'nude, breast' }), true, '单数 breast 也要能被中信号命中')
  assert.equal(isNsfw({ prompt: 'nude, breasts' }), true, '复数同样')
  assert.equal(isNsfw({ prompt: 'pussies' }), true)
  assert.equal(isNsfw({ prompt: 'nudity' }), true)
})

test('裸写的 lewd / sex / cum 不因下划线失效', () => {
  assert.equal(isNsfw({ prompt: 'lewd, nude' }), true)
  assert.equal(isNsfw({ prompt: 'sex, topless' }), true)
  assert.equal(isNsfw({ prompt: 'cum, nude' }), true)
})

test('中文：裸露 / 赤裸 / 半裸 都要认', () => {
  // 真实 prompt 里写的是「完全裸露」「全身赤裸」，词表曾经只认「裸体」
  assert.equal(isNsfw({ prompt: '完全裸露' }), true)
  assert.equal(isNsfw({ prompt: '全身赤裸' }), true)
  assert.equal(isNsfw({ prompt: '半裸' }), true)
  assert.equal(isNsfw({ prompt: '一个女孩，裸体' }), true)
})

test('常见误伤候选不能触雷', () => {
  // ass 会命中 sunglasses，所以没进词表
  assert.equal(isNsfw({ prompt: 'sunglasses, ass' }), false)
  assert.equal(isNsfw({ prompt: 'panties' }), false, '单个中信号不算')
  assert.equal(isNsfw({ prompt: 'breast cancer awareness poster' }), false)
  assert.equal(isNsfw({ prompt: 'nude beach landscape' }), false)
})

test('空输入不崩', () => {
  assert.equal(isNsfw({}), false)
  assert.equal(isNsfw({ prompt: '' }), false)
  assert.equal(isNsfw({ prompt: undefined, name: undefined }), false)
})

test('判定带原因（诊断用）', () => {
  const v = nsfwVerdictOf({ prompt: 'nsfw, pussy' })
  assert.equal(v.nsfw, true)
  assert.ok(v.why.includes('nsfw'), `应当记下命中的词：${JSON.stringify(v.why)}`)
  const clean = nsfwVerdictOf({ prompt: 'a cat' })
  assert.equal(clean.nsfw, false)
  assert.deepEqual(clean.why, [])
})
