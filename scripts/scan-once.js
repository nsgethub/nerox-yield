// One scan without Redis: prints the grade count and the largest pools.
// Usage: node scripts/scan-once.js [out.json]
const fs = require('fs')
const { scanOnce } = require('../src/services/yieldScan')

const money = (x) => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x / 1e3)}K`)

scanOnce({ dry: true, gpMax: 20 })
  .then((s) => {
    console.log('sources:', s.sources.join(', '))
    console.log('counts:', JSON.stringify(s.counts))
    console.log('grades:', JSON.stringify(s.grades))
    for (const p of s.pools.slice(0, 15)) {
      const apy = (Number(p.apy) || 0).toFixed(2)
      console.log(`${p.grade} ${String(p.score).padStart(3)}  ${money(p.tvl).padStart(8)}  ${apy}%  ${p.protocolName}: ${p.name}`)
    }
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(s, null, 1))
  })
  .catch((e) => {
    console.error('scan failed:', e.message)
    process.exit(1)
  })
