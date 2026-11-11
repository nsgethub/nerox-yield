// NeroX Yield for AI agents: MCP endpoint (JSON-RPC over HTTP POST) and the ERC-8004 registration file.
// Free, read-only, no keys. The same data as neroxcoin.org/yield.
const express = require('express')
const { getSnapshot } = require('../services/yieldScan')
const { getRedis } = require('../services/redis')
const router = express.Router()

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const CONTRACT = '0xA187f9168696D763e8700Db128517BCe04C61f23'
const WALLET = '0x2aB5a3A117021974D3Ed28d5568f5dDD7108D3Ab'
const REGISTRY = 'eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
const ORDER = { A: 0, B: 1, C: 2, D: 3, E: 4 }
const NOTE = 'Rule-based risk check, not financial advice and not a promise of return. Data: DefiLlama, DexPaprika, GoPlus, BNB Chain RPC; refreshed hourly.'

const TOOLS = [
  {
    name: 'list_pools',
    description: 'List yield pools on BNB Smart Chain with a risk grade from A (low risk) to E (very high risk). ' +
      'Filter by worst allowed grade, stablecoin-only, minimum pool size and minimum yield. Returns id, name, protocol, grade, score (0-100), APY %, TVL in USD and the main risk reason.',
    inputSchema: {
      type: 'object',
      properties: {
        max_grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'], description: 'Worst grade to include. "B" returns A and B. Default "E".' },
        stable_only: { type: 'boolean', description: 'Only stablecoin positions. Default false.' },
        min_tvl_usd: { type: 'number', description: 'Minimum money in the pool, USD. Default 0.' },
        min_apy: { type: 'number', description: 'Minimum yield, % a year. Default 0.' },
        sort: { type: 'string', enum: ['tvl', 'apy', 'score'], description: 'Sort order, highest first. Default "tvl".' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many pools to return. Default 20.' },
      },
    },
  },
  {
    name: 'get_pool_risk',
    description: 'Full risk report for one BNB Smart Chain pool: grade A-E, score, every reason with its severity ' +
      '(pool size, age, audit, past hacks, yield source, token contract checks), APY, TVL and tokens. ' +
      'Pass a pool id from list_pools, a pool contract address (0x...) or a name such as "USDT-WBNB".',
    inputSchema: {
      type: 'object',
      properties: { pool: { type: 'string', description: 'Pool id, pool contract address or part of the pool name.' } },
      required: ['pool'],
    },
  },
]

const brief = (p) => {
  const top = (p.reasons || []).find((r) => r.level !== 'good' && r.level !== 'info')
  return {
    id: p.id, name: p.name, protocol: p.protocolName, kind: p.kind, grade: p.grade, score: p.score,
    apy: p.apy == null ? null : Math.round(p.apy * 100) / 100, tvlUsd: Math.round(p.tvl || 0), stable: !!p.stable,
    mainRisk: top ? top.text : null, url: `https://neroxcoin.org/yield/${encodeURIComponent(p.id)}`,
  }
}
const meta = (s) => ({ updatedAt: new Date(s.at).toISOString(), chain: 'BNB Smart Chain (56)', onChainGrades: CONTRACT, note: NOTE })

async function listPools(a) {
  const s = await getSnapshot()
  if (!s) throw new Error('Data is being prepared, try again in a few minutes.')
  const max = ORDER[a.max_grade] == null ? 4 : ORDER[a.max_grade]
  let list = s.pools.filter((p) => (Number(p.apy) || 0) >= Math.max(0.1, Number(a.min_apy) || 0) && ORDER[p.grade] <= max &&
    (p.tvl || 0) >= (Number(a.min_tvl_usd) || 0) && (!a.stable_only || p.stable))
  const key = a.sort === 'apy' ? 'apy' : a.sort === 'score' ? 'score' : 'tvl'
  list = list.sort((x, y) => (y[key] || 0) - (x[key] || 0))
  const limit = Math.min(Math.max(parseInt(a.limit) || 20, 1), 50)
  return { ...meta(s), matched: list.length, pools: list.slice(0, limit).map(brief) }
}

async function poolRisk(a) {
  const s = await getSnapshot()
  if (!s) throw new Error('Data is being prepared, try again in a few minutes.')
  const q = String(a.pool || '').trim().toLowerCase().slice(0, 80)
  if (!q) throw new Error('Pass "pool": a pool id, a pool address or part of its name.')
  let hits = s.pools.filter((p) => String(p.id).toLowerCase() === q)
  if (!hits.length) hits = s.pools.filter((p) => (p.name + ' ' + p.protocolName).toLowerCase().includes(q)).sort((x, y) => y.tvl - x.tvl)
  if (!hits.length) return { ...meta(s), found: false, message: 'No such pool in the NeroX Yield list (pools under $100K are not tracked).' }
  const p = hits[0]
  return {
    ...meta(s), found: true,
    pool: {
      ...brief(p), category: p.category, apyBase: p.apyBase, apyReward: p.apyReward, apyMean30d: p.apyMean30d,
      tvlChange7d: p.tvl7dChange, tokens: p.tokens, source: p.source, sourceUrl: p.url,
      reasons: (p.reasons || []).map((r) => ({ severity: r.level, code: r.key, text: r.text })),
    },
    otherMatches: hits.slice(1, 6).map(brief),
  }
}

async function count(what, req) {
  try {
    const r = getRedis()
    const day = new Date().toISOString().slice(0, 10)
    const ua = String(req.headers['user-agent'] || '-').slice(0, 60)
    await r.hincrby(`agent:calls:${day}`, what, 1)
    await r.hincrby(`agent:ua:${day}`, ua, 1)
    await r.expire(`agent:calls:${day}`, 40 * 86400)
    await r.expire(`agent:ua:${day}`, 40 * 86400)
  } catch {}
}

async function handle(m, req) {
  const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result })
  const fail = (code, message) => ({ jsonrpc: '2.0', id: m.id == null ? null : m.id, error: { code, message } })
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(-32600, 'Invalid Request')
  if (m.id == null) return null // notification
  const p = m.params || {}
  if (m.method === 'initialize') {
    count('initialize', req)
    return ok({
      protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[1],
      capabilities: { tools: {} },
      serverInfo: { name: 'nerox-yield', title: 'NeroX Yield Risk', version: '1.0.0' },
      instructions: 'Risk grades (A-E) with reasons for yield pools on BNB Smart Chain. Use list_pools to find pools, get_pool_risk for one pool. ' + NOTE,
    })
  }
  if (m.method === 'ping') return ok({})
  if (m.method === 'tools/list') { count('tools/list', req); return ok({ tools: TOOLS }) }
  if (m.method === 'tools/call') {
    const fn = p.name === 'list_pools' ? listPools : p.name === 'get_pool_risk' ? poolRisk : null
    if (!fn) return fail(-32602, 'Unknown tool: ' + String(p.name).slice(0, 40))
    count('call:' + p.name, req)
    try {
      const data = await fn(p.arguments || {})
      return ok({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false })
    } catch (e) {
      return ok({ content: [{ type: 'text', text: String(e.message).slice(0, 200) }], isError: true })
    }
  }
  return fail(-32601, 'Method not found')
}

router.post('/mcp', async (req, res) => {
  try {
    const b = req.body
    if (Array.isArray(b)) {
      const out = (await Promise.all(b.slice(0, 20).map((m) => handle(m, req)))).filter(Boolean)
      return out.length ? res.json(out) : res.status(202).end()
    }
    const r = await handle(b, req)
    return r ? res.json(r) : res.status(202).end()
  } catch (e) {
    res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } })
  }
})
router.all('/mcp', (req, res) => res.set('Allow', 'POST').status(405).json({ error: 'Use POST with JSON-RPC (MCP).' }))

// ERC-8004 registration file
router.get('/registration.json', async (req, res) => {
  let reg = { agentId: 416550 }
  res.set('Cache-Control', 'public, max-age=300')
  res.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'NeroX Yield Risk',
    description: 'Risk grades from A (low) to E (very high) with plain-language reasons for yield pools on BNB Smart Chain: ' +
      'PancakeSwap, Venus, Lista, Uniswap and others. Checks pool size, age, audits, past hacks, where the yield comes from and token contracts. ' +
      'Free and read-only. Grades are also written on-chain daily: ' + CONTRACT + '. Not financial advice.',
    image: 'https://neroxcoin.org/og-image.png',
    services: [
      { name: 'MCP', endpoint: 'https://api.neroxcoin.org/api/agent/mcp', version: '2025-06-18', mcpTools: TOOLS.map((t) => t.name) },
      { name: 'web', endpoint: 'https://neroxcoin.org/yield' },
      { name: 'agentWallet', endpoint: 'eip155:56:' + WALLET },
    ],
    x402Support: false,
    active: true,
    registrations: reg && reg.agentId != null ? [{ agentId: Number(reg.agentId), agentRegistry: REGISTRY }] : [],
    supportedTrust: [],
  })
})

module.exports = router
