// NeroX Yield API: the same routes and scanner that run on neroxcoin.org.
const express = require('express')
const { initRedis } = require('./services/redis')
const { startYieldScanner } = require('./services/yieldScan')

const PORT = parseInt(process.env.PORT) || 4000

async function main() {
  await initRedis()
  const app = express()
  app.use('/api/yield', require('./routes/yield'))
  app.get('/health', (req, res) => res.json({ ok: true }))
  app.listen(PORT, () => console.log(`[yield] http://localhost:${PORT}/api/yield/status`))
  startYieldScanner() // first scan after 20 s, then every hour
}

main().catch((e) => {
  console.error('[yield] start failed:', e.message)
  process.exit(1)
})
