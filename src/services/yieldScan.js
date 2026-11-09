// NeroX Yield — сбор данных о пулах BNB Chain и расчёт риска. Раз в час:
//  DefiLlama (пулы, протоколы, взломы) + DexPaprika (пулы PancakeSwap v2/v3) + сеть BNB Chain (комиссия пула,
//  символы токенов) + GoPlus (безопасность токенов, понемногу из-за лимитов). Итог — снимок в Redis.
const axios = require('axios')
const { getRedis } = require('./redis')
const { assess } = require('./yieldRisk')

const SNAP = 'yield:bsc:v1'
const MIN_TVL = 100e3
const RPC = ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com']
const LP_SHARE = { 100: 0.67, 500: 0.66, 2500: 0.68, 10000: 0.68 }   // доля комиссии, которая идёт поставщикам (docs.pancakeswap.finance)
const ISSUER_CATS = new Set(['RWA', 'Basis Trading', 'CeDeFi', 'CEX', 'Onchain Capital Allocator', 'Risk Curators'])
const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'USD1', 'TUSD', 'USDE', 'LISUSD', 'USDD', 'U', 'FRAX', 'USDF'])
const ZERO = '0x0000000000000000000000000000000000000000'
const http = axios.create({ timeout: 60000, headers: { 'User-Agent': 'NeroX/1.0 (+https://neroxcoin.org)', Accept: 'application/json' } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const state = { running: false, lastRun: 0, lastOk: 0, error: '', stage: '', took: 0 }

async function cacheGet(k) {
  try { const v = await getRedis().get(k); return v ? JSON.parse(v) : null } catch { return null }
}
async function cacheSet(k, v, ttl) {
  try { await getRedis().set(k, JSON.stringify(v), 'EX', ttl) } catch {}
}

async function rpc(to, data) {
  for (const url of RPC) {
    try {
      const { data: j } = await http.post(url, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }, { timeout: 15000 })
      if (j && typeof j.result === 'string') return j.result === '0x' ? null : j.result
    } catch {}
  }
  return null
}

function decodeString(hex) {
  if (!hex || hex.length < 66) return null
  const h = hex.slice(2)
  const clean = (s) => s.replace(/\u0000/g, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || null
  try {
    if (h.length >= 192) {
      const off = parseInt(h.slice(0, 64), 16) * 2
      const len = parseInt(h.slice(off, off + 64), 16)
      if (len > 0 && len < 64) return clean(Buffer.from(h.slice(off + 64, off + 64 + len * 2), 'hex').toString('utf8'))
    }
    return clean(Buffer.from(h.slice(0, 64), 'hex').toString('utf8'))
  } catch { return null }
}

async function symbolOf(addr) {
  const k = `yield:sym:${addr}`
  const c = await cacheGet(k)
  if (c) return c
  const s = decodeString(await rpc(addr, '0x95d89b41')) || addr.slice(0, 6)
  await cacheSet(k, s, 30 * 86400)
  return s
}

async function feeOf(pool) {
  const k = `yield:fee:${pool}`
  const c = await cacheGet(k)
  if (c) return c
  const hex = await rpc(pool, '0xddca3f43')
  const v = hex ? parseInt(hex.slice(2), 16) : null
  if (v && v < 1e6) await cacheSet(k, v, 30 * 86400)
  return v && v < 1e6 ? v : null
}

// ---------- DefiLlama ----------
async function llamaPools() {
  const { data } = await http.get('https://yields.llama.fi/pools', { timeout: 120000 })
  return (data && data.data || []).filter((p) => p.chain === 'BSC' && (p.tvlUsd || 0) >= MIN_TVL)
}

async function llamaProtocols() {
  const c = await cacheGet('yield:protocols')
  if (c) return c
  const { data } = await http.get('https://api.llama.fi/protocols', { timeout: 120000 })
  const list = Array.isArray(data) ? data : []
  const parentAudit = {}
  for (const p of list) if (p.parentProtocol && String(p.audits) === '2') parentAudit[p.parentProtocol] = true
  let hacks = []
  try {
    const h = await http.get('https://api.llama.fi/hacks', { timeout: 60000 })
    hacks = Array.isArray(h.data) ? h.data : []
  } catch {}
  const byId = {}, byName = {}
  for (const h of hacks) {
    const d = typeof h.date === 'number' ? new Date(h.date * (h.date < 1e12 ? 1000 : 1)) : new Date(h.date)
    const item = { date: isNaN(d) ? '' : d.toISOString().slice(0, 10), amount: Number(h.amount) || 0 }
    if (h.defillamaId != null) (byId[String(h.defillamaId)] = byId[String(h.defillamaId)] || []).push(item)
    if (h.name) (byName[String(h.name).toLowerCase()] = byName[String(h.name).toLowerCase()] || []).push(item)
  }
  const out = {}
  for (const p of list) {
    if (!p.slug) continue
    out[p.slug] = {
      name: p.name, category: p.category || '', url: p.url || '',
      audited: String(p.audits) === '2' || !!parentAudit[p.parentProtocol],
      listedAt: p.listedAt ? p.listedAt * 1000 : null,
      issuer: ISSUER_CATS.has(p.category),
      hacks: (byId[String(p.id)] || byName[String(p.name || '').toLowerCase()] || []).sort((a, b) => (a.date < b.date ? 1 : -1)),
    }
  }
  await cacheSet('yield:protocols', out, 86400)
  return out
}

// ---------- PancakeSwap (DexPaprika) ----------
async function cakePools(dex) {
  const { data } = await http.get(`https://api.dexpaprika.com/networks/bsc/pools/search?dex_name=${dex}&limit=100`, { timeout: 60000 })
  const list = (data && (data.results || data.pools)) || []
  return list.filter((p) => (Number(p.liquidity_usd) || 0) >= MIN_TVL)
}

// ---------- GoPlus ----------
async function checkTokens(addrs, max) {
  const res = {}
  let fresh = 0
  for (const a of addrs) {
    const k = `yield:gp:${a}`
    const c = await cacheGet(k)
    if (c) { res[a] = c; continue }
    if (fresh >= max) continue
    fresh++
    try {
      const { data } = await http.get(`https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${a}`, { timeout: 30000 })
      const t = data && data.result && (data.result[a] || data.result[a.toLowerCase()])
      if (t) {
        const keep = {}
        for (const f of ['is_honeypot', 'cannot_sell_all', 'cannot_buy', 'buy_tax', 'sell_tax', 'hidden_owner', 'owner_change_balance',
          'can_take_back_ownership', 'selfdestruct', 'is_open_source', 'is_mintable', 'is_proxy', 'transfer_pausable',
          'is_blacklisted', 'slippage_modifiable', 'personal_slippage_modifiable', 'holder_count', 'trust_list', 'token_symbol'])
          keep[f] = t[f]
        res[a] = keep
        await cacheSet(k, keep, 86400)
      }
    } catch {}
    await sleep(2500)
  }
  return { res, fresh }
}

function kindOf(cat) {
  return ({ Dexs: 'Liquidity pool', Lending: 'Lending', 'Liquid Staking': 'Staking', Yield: 'Yield vault',
    'Yield Aggregator': 'Yield vault', RWA: 'Real-world assets', 'Basis Trading': 'Strategy', CDP: 'Stablecoin vault' })[cat] || cat || 'Pool'
}

// ---------- сборка ----------
async function scanOnce(opts = {}) {
  const t0 = Date.now()
  const now = Date.now()
  const counts = {}
  state.stage = 'defillama'
  const [ll, protocols] = await Promise.all([llamaPools(), llamaProtocols()])
  counts.defillama = ll.length

  state.stage = 'pancakeswap'
  let v3 = [], v2 = []
  try { v3 = await cakePools('pancakeswap_v3') } catch (e) { counts.v3err = String(e.message).slice(0, 80) }
  await sleep(1500)
  try { v2 = await cakePools('pancakeswap_v2') } catch (e) { counts.v2err = String(e.message).slice(0, 80) }
  counts.pancakeV3 = v3.length
  counts.pancakeV2 = v2.length

  const pools = []
  for (const p of ll) {
    if (p.project === 'pancakeswap-amm' && v2.length) continue
    const pr = protocols[p.project] || { name: p.project, category: '', audited: false, issuer: false, hacks: [] }
    const syms = String(p.symbol || '').split('-')
    const addrs = (p.underlyingTokens || []).map((a) => String(a).toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a) && a !== ZERO)
    pools.push({
      id: p.pool, source: 'defillama', project: p.project, protocol: pr, kind: kindOf(pr.category),
      name: p.symbol + (p.poolMeta ? ` (${p.poolMeta})` : ''),
      tokens: addrs.map((a, i) => ({ address: a, symbol: syms[i] || a.slice(0, 6) })),
      tvl: p.tvlUsd, apy: p.apy, apyBase: p.apyBase, apyReward: p.apyReward, apyMean30d: p.apyMean30d,
      stable: !!p.stablecoin, ilRisk: p.ilRisk === 'yes', outlier: !!p.outlier,
      trend: p.predictions && p.predictions.predictedClass, volume24h: p.volumeUsd1d || null,
      url: `https://defillama.com/yields/pool/${p.pool}`, site: pr.url || '', createdAt: null,
    })
  }

  state.stage = 'pancakeswap-details'
  for (const [list, ver] of [[v3, 'v3'], [v2, 'v2']]) {
    const slug = ver === 'v3' ? 'pancakeswap-amm-v3' : 'pancakeswap-amm'
    const pr = protocols[slug] || { name: ver === 'v3' ? 'PancakeSwap AMM V3' : 'PancakeSwap AMM', audited: true, hacks: [] }
    for (const p of list) {
      const addr = String(p.id).toLowerCase()
      const toks = []
      for (const t of p.tokens || []) {
        const a = String(t.id || '').toLowerCase()
        if (/^0x[0-9a-f]{40}$/.test(a)) toks.push({ address: a, symbol: t.symbol || await symbolOf(a) })
      }
      const fee = ver === 'v3' ? await feeOf(addr) : 2500
      const liq = Number(p.liquidity_usd) || 0
      const vol7 = Number(p.volume_usd_7d) || 0
      const vol1 = Number(p.volume_usd_24h) || 0
      const share = LP_SHARE[fee] || 0.67
      const feeApr = fee && liq ? ((vol7 ? vol7 / 7 : vol1) * (fee / 1e6) * share * 365 / liq) * 100 : null
      const stable = toks.length > 1 && toks.every((t) => STABLES.has(String(t.symbol).toUpperCase()))
      pools.push({
        id: addr, source: `pancakeswap-${ver}`, project: slug, protocol: pr, kind: 'Liquidity pool',
        name: toks.map((t) => t.symbol).join('-') + (fee ? ` (${fee / 1e4}%)` : ''),
        tokens: toks, tvl: liq, apy: feeApr, apyBase: feeApr, apyReward: null, apyMean30d: null, feeApr,
        stable, ilRisk: !stable, outlier: false, trend: null, volume24h: vol1 || null,
        url: `https://bscscan.com/address/${addr}`,
        createdAt: p.created_at ? Date.parse(p.created_at) : null, fee,
      })
    }
  }

  // отток за 7 дней — по собственным дневным снимкам
  state.stage = 'history'
  const day = new Date(now).toISOString().slice(0, 10)
  const day7 = new Date(now - 7 * 86400000).toISOString().slice(0, 10)
  const prev7 = (await cacheGet(`yield:hist:${day7}`)) || {}
  for (const p of pools) {
    const old = prev7[p.id]
    if (old && old > 0) p.tvl7dChange = p.tvl / old - 1
  }
  if (!opts.dry) {
    const today = {}
    for (const p of pools) today[p.id] = Math.round(p.tvl)
    await cacheSet(`yield:hist:${day}`, today, 40 * 86400)
  }

  state.stage = 'goplus'
  const addrs = [...new Set(pools.flatMap((p) => p.tokens.map((t) => t.address)))]
  const { res: tokens, fresh } = await checkTokens(addrs, opts.gpMax == null ? 80 : opts.gpMax)
  counts.tokens = addrs.length
  counts.tokensChecked = Object.keys(tokens).length
  counts.tokensFresh = fresh

  state.stage = 'assess'
  const out = []
  for (const p of pools) {
    const a = assess(p, { now, tokens })
    const pr = p.protocol || {}
    out.push({
      id: p.id, source: p.source, project: p.project, protocolName: pr.name || p.project, category: pr.category || '',
      kind: p.kind, name: p.name, tokens: p.tokens, tvl: p.tvl, apy: p.apy, apyBase: p.apyBase, apyReward: p.apyReward,
      apyMean30d: p.apyMean30d, feeApr: p.feeApr == null ? null : p.feeApr, fee: p.fee || null, stable: p.stable,
      ilRisk: p.ilRisk, trend: p.trend, volume24h: p.volume24h, tvl7dChange: p.tvl7dChange == null ? null : p.tvl7dChange,
      createdAt: p.createdAt, url: p.url, site: p.site || (pr.url || ''), score: a.score, grade: a.grade, gradeLabel: a.gradeLabel, reasons: a.reasons,
    })
  }
  out.sort((a, b) => b.tvl - a.tvl)
  const grades = {}
  for (const p of out) grades[p.grade] = (grades[p.grade] || 0) + 1
  const snap = { at: now, counts, grades, pools: out, sources: ['DefiLlama', 'DexPaprika', 'GoPlus', 'BNB Chain RPC'] }
  if (!opts.dry) {
    await cacheSet(SNAP, snap, 7 * 86400)
  }
  state.took = Date.now() - t0
  return snap
}

async function getSnapshot() {
  return cacheGet(SNAP)
}

function startYieldScanner() {
  const run = async () => {
    if (state.running) return
    state.running = true
    state.lastRun = Date.now()
    try {
      await scanOnce()
      state.lastOk = Date.now()
      state.error = ''
    } catch (e) {
      state.error = String(e && e.message || e).slice(0, 200)
      console.error('[yield] scan failed:', state.error)
    } finally {
      state.running = false
      state.stage = ''
    }
  }
  setTimeout(run, 20000)
  setInterval(run, 60 * 60 * 1000)
}

module.exports = { scanOnce, getSnapshot, startYieldScanner, state, decodeString }
