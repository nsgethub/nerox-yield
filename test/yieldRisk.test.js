const test = require('node:test')
const assert = require('node:assert')
const { assess, tokenReasons } = require('../src/services/yieldRisk')

const DAY = 86400000
const now = Date.parse('2026-11-01T00:00:00Z')
const keys = (r) => r.reasons.map((x) => x.key)

test('large stablecoin pool of an old audited protocol gets A', () => {
  const p = {
    tvl: 120e6, apy: 4.5, apyReward: 0, stable: true, ilRisk: false,
    protocol: { name: 'Venus', listedAt: now - 1500 * DAY, audited: true, hacks: [] },
    tokens: [{ address: '0xa', symbol: 'USDT' }],
  }
  const r = assess(p, { now, tokens: { '0xa': { trust_list: '1', is_open_source: '1', is_mintable: '1' } } })
  assert.strictEqual(r.grade, 'A')
  assert.strictEqual(r.score, 100)
  assert.ok(keys(r).includes('stable'))
  assert.ok(!keys(r).includes('mintable'), 'owner rights of trusted tokens are not penalised')
})

test('honeypot token makes the pool E', () => {
  const p = { tvl: 5e6, apy: 8, protocol: null, tokens: [{ address: '0xb', symbol: 'BAD' }] }
  const r = assess(p, { now, tokens: { '0xb': { is_honeypot: '1' } } })
  assert.strictEqual(r.grade, 'E')
  assert.strictEqual(r.reasons[0].level, 'critical')
})

test('small pool with an extreme yield gets C', () => {
  const p = { tvl: 200e3, apy: 300, protocol: null, tokens: [] }
  const r = assess(p, { now, tokens: {} })
  assert.deepStrictEqual(keys(r).sort(), ['apy_extreme', 'tvl_tiny'])
  assert.strictEqual(r.score, 50)
  assert.strictEqual(r.grade, 'C')
})

test('recent hack weighs more than an old one', () => {
  const base = { tvl: 10e6, apy: 5, tokens: [] }
  const pr = (date) => ({ name: 'X', listedAt: now - 1000 * DAY, audited: true, hacks: [{ date, amount: 1e6 }] })
  const recent = assess({ ...base, protocol: pr('2026-03-01') }, { now, tokens: {} })
  const old = assess({ ...base, protocol: pr('2021-03-01') }, { now, tokens: {} })
  assert.ok(recent.score < old.score)
})

test('pending token check adds no penalty', () => {
  const out = tokenReasons('NEW', undefined)
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].level, 'info')
})

test('owner who can pause transfers keeps the pool at C or lower', () => {
  // как пул мем-токена с WBNB в аудите: аудит у протокола есть, но владелец токена может остановить переводы
  const p = {
    tvl: 1.2e6, apy: 28.9, apyReward: 0, stable: false, ilRisk: true,
    protocol: { name: 'PancakeSwap AMM', listedAt: now - 1500 * DAY, audited: true, hacks: [] },
    tokens: [{ address: '0xm', symbol: 'MEME' }, { address: '0xw', symbol: 'WBNB' }],
  }
  const r = assess(p, { now, tokens: { '0xm': { is_open_source: '1', transfer_pausable: '1' }, '0xw': { trust_list: '1', is_open_source: '1' } } })
  assert.strictEqual(r.grade, 'C')
  assert.ok(r.score <= 69)
  assert.strictEqual(r.reasons.find((x) => x.key === 'pausable').level, 'high')
})

test('trusted tokens are not capped for owner rights', () => {
  const p = { tvl: 80e6, apy: 4, stable: true, protocol: { name: 'Venus', listedAt: now - 1500 * DAY, audited: true, hacks: [] },
    tokens: [{ address: '0xu', symbol: 'USDC' }] }
  const r = assess(p, { now, tokens: { '0xu': { trust_list: '1', is_open_source: '1', is_proxy: '1', transfer_pausable: '1', is_blacklisted: '1' } } })
  assert.strictEqual(r.grade, 'A')
})

test('19% outflow in 7 days is a medium finding, 30% is high', () => {
  const base = { tvl: 10e6, apy: 5, protocol: null, tokens: [] }
  const mid = assess({ ...base, tvl7dChange: -0.191 }, { now, tokens: {} })
  const big = assess({ ...base, tvl7dChange: -0.35 }, { now, tokens: {} })
  assert.strictEqual(mid.reasons.find((x) => x.key === 'tvl_outflow').level, 'medium')
  assert.strictEqual(big.reasons.find((x) => x.key === 'tvl_outflow').level, 'high')
  assert.strictEqual(assess({ ...base, tvl7dChange: -0.1 }, { now, tokens: {} }).reasons.length, 0)
})
