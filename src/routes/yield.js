// NeroX Yield — открытые данные: доходность и риск пулов на BNB Chain (без входа).
const express = require('express')
const { getSnapshot, state } = require('../services/yieldScan')
const router = express.Router()

const ORDER = { A: 0, B: 1, C: 2, D: 3, E: 4 }

function slim(p) {
  const top = (p.reasons || []).find((r) => r.level !== 'good' && r.level !== 'info') || (p.reasons || [])[0] || null
  return {
    id: p.id, name: p.name, protocolName: p.protocolName, kind: p.kind, source: p.source,
    tvl: p.tvl, apy: p.apy, apyBase: p.apyBase, apyReward: p.apyReward, stable: p.stable,
    grade: p.grade, gradeLabel: p.gradeLabel, score: p.score, top: top ? top.text : '',
    topKey: top ? top.key : '', topP: top ? (top.p || {}) : {},
    tvl7dChange: p.tvl7dChange,
  }
}

router.get('/pools', async (req, res) => {
  try {
    const s = await getSnapshot()
    if (!s) return res.status(503).json({ error: 'preparing', state: { stage: state.stage, running: state.running } })
    let list = s.pools
    // по умолчанию не показываем пулы, которые почти ничего не платят (залог в кредитовании и т.п.)
    const withZero = req.query.zero === '1'
    const paying = list.filter((p) => (Number(p.apy) || 0) >= 0.1)
    const hidden = withZero ? 0 : list.length - paying.length
    if (!withZero) list = paying
    const view = String(req.query.view || 'all')
    if (view === 'stable') list = list.filter((p) => p.stable)
    if (view === 'safer') list = list.filter((p) => p.grade === 'A' || p.grade === 'B')
    if (view === 'pancakeswap') list = list.filter((p) => String(p.source).startsWith('pancakeswap'))
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 40)
    if (q) list = list.filter((p) => (p.name + ' ' + p.protocolName).toLowerCase().includes(q))
    const sort = String(req.query.sort || 'tvl')
    list = [...list]
    if (sort === 'apy') list.sort((a, b) => (b.apy || 0) - (a.apy || 0))
    else if (sort === 'risk') list.sort((a, b) => ORDER[a.grade] - ORDER[b.grade] || b.tvl - a.tvl)
    else list.sort((a, b) => b.tvl - a.tvl)
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 300, 1), 500)
    res.set('Cache-Control', 'public, max-age=300')
    res.json({ at: s.at, total: list.length, all: s.pools.length, hidden, grades: s.grades, sources: s.sources,
               pools: list.slice(0, limit).map(slim) })
  } catch (e) {
    res.status(500).json({ error: 'failed' })
  }
})

router.get('/pool/:id', async (req, res) => {
  try {
    const s = await getSnapshot()
    if (!s) return res.status(503).json({ error: 'preparing' })
    const id = String(req.params.id).toLowerCase()
    const p = s.pools.find((x) => String(x.id).toLowerCase() === id)
    if (!p) return res.status(404).json({ error: 'not_found' })
    res.set('Cache-Control', 'public, max-age=300')
    res.json({ at: s.at, sources: s.sources, pool: p })
  } catch (e) {
    res.status(500).json({ error: 'failed' })
  }
})

router.get('/status', async (req, res) => {
  const s = await getSnapshot().catch(() => null)
  res.json({ ready: !!s, at: s ? s.at : null, pools: s ? s.pools.length : 0, grades: s ? s.grades : {},
             counts: s ? s.counts : {}, running: state.running, stage: state.stage, lastOk: state.lastOk,
             error: state.error, took: state.took })
})

module.exports = router
