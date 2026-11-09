// NeroX Yield — оценка риска пула простыми правилами. Каждая причина хранит ключ и текст,
// чтобы позже перевести тексты на другие языки, не меняя логику.
const DAY = 86400000

const GRADES = [
  [85, 'A', 'Low risk'],
  [70, 'B', 'Moderate risk'],
  [50, 'C', 'Elevated risk'],
  [30, 'D', 'High risk'],
  [-1, 'E', 'Very high risk'],
]
const PENALTY = { critical: 100, high: 25, medium: 10, low: 4, info: 0, good: 0 }

const money = (x) => {
  x = Number(x) || 0
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`
  if (x >= 1e3) return `$${Math.round(x / 1e3)}K`
  return `$${Math.round(x)}`
}
const pct = (x) => {
  x = Number(x) || 0
  return x >= 100 ? `${Math.round(x)}%` : x >= 10 ? `${x.toFixed(1)}%` : `${x.toFixed(2)}%`
}
const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10)

// Проверка токена (GoPlus). trust_list = '1' — известный токен (USDT, WBNB и т.п.): права владельца
// для таких токенов — обычное устройство эмитента, не признак ловушки.
function tokenReasons(sym, t) {
  const out = []
  if (!t) {
    out.push({ level: 'info', key: 'token_pending', p: { sym }, text: `${sym}: token safety check is pending.` })
    return out
  }
  const on = (k) => String(t[k]) === '1'
  const trusted = on('trust_list')
  const tax = Math.max(Number(t.buy_tax) || 0, Number(t.sell_tax) || 0)
  if (on('is_honeypot') || on('cannot_sell_all'))
    out.push({ level: 'critical', key: 'honeypot', p: { sym }, text: `${sym}: the token cannot be sold (honeypot).` })
  if (on('cannot_buy'))
    out.push({ level: 'high', key: 'cannot_buy', p: { sym }, text: `${sym}: the token cannot be bought freely.` })
  if (tax >= 0.1)
    out.push({ level: 'high', key: 'tax_high', p: { sym, tax: Math.round(tax * 100) }, text: `${sym}: ${Math.round(tax * 100)}% tax on buying or selling.` })
  else if (tax > 0.01)
    out.push({ level: 'medium', key: 'tax', p: { sym, tax: (tax * 100).toFixed(1) }, text: `${sym}: ${(tax * 100).toFixed(1)}% tax on buying or selling.` })
  if (on('hidden_owner'))
    out.push({ level: 'critical', key: 'hidden_owner', p: { sym }, text: `${sym}: the contract has a hidden owner.` })
  if (on('owner_change_balance'))
    out.push({ level: 'critical', key: 'owner_balance', p: { sym }, text: `${sym}: the owner can change anyone's balance.` })
  if (on('can_take_back_ownership'))
    out.push({ level: 'high', key: 'take_back', p: { sym }, text: `${sym}: the owner can take back control after giving it up.` })
  if (on('selfdestruct'))
    out.push({ level: 'high', key: 'selfdestruct', p: { sym }, text: `${sym}: the contract can destroy itself.` })
  if (String(t.is_open_source) === '0')
    out.push({ level: 'high', key: 'closed_source', p: { sym }, text: `${sym}: the token code is not published.` })
  if (!trusted) {
    if (on('is_mintable'))
      out.push({ level: 'medium', key: 'mintable', p: { sym }, text: `${sym}: the owner can create new tokens.` })
    if (on('is_proxy'))
      out.push({ level: 'medium', key: 'proxy', p: { sym }, text: `${sym}: the token code can be replaced by its owner.` })
    if (on('transfer_pausable'))
      out.push({ level: 'medium', key: 'pausable', p: { sym }, text: `${sym}: transfers can be paused by the owner.` })
    if (on('is_blacklisted'))
      out.push({ level: 'low', key: 'blacklist', p: { sym }, text: `${sym}: the owner can block addresses.` })
    if (on('slippage_modifiable') || on('personal_slippage_modifiable'))
      out.push({ level: 'high', key: 'tax_change', p: { sym }, text: `${sym}: the owner can change the tax at any time.` })
    const holders = Number(t.holder_count) || 0
    if (holders && holders < 300)
      out.push({ level: 'medium', key: 'few_holders', p: { sym, n: holders }, text: `${sym}: only ${holders} holders.` })
  }
  return out
}

// p — пул в общем виде (см. yieldScan.js), ctx — { now, tokens: {addr: goplus}, prev7 }
function assess(p, ctx) {
  const now = ctx.now || Date.now()
  const r = []
  const add = (level, key, text, prm) => r.push({ level, key, p: prm || {}, text })

  // деньги в пуле
  if (p.tvl < 250e3) add('high', 'tvl_tiny', `Very little money in the pool (${money(p.tvl)}). One large withdrawal can change the yield sharply.`, { tvl: money(p.tvl) })
  else if (p.tvl < 1e6) add('medium', 'tvl_small', `Small pool (${money(p.tvl)}). Yield can change quickly when money moves in or out.`, { tvl: money(p.tvl) })
  else if (p.tvl >= 50e6) add('good', 'tvl_large', `Large pool (${money(p.tvl)}).`, { tvl: money(p.tvl) })

  // отток денег за 7 дней
  if (p.tvl7dChange != null && p.tvl7dChange <= -0.3)
    add('high', 'tvl_outflow', `Money is leaving: ${Math.round(-p.tvl7dChange * 100)}% less in the pool than 7 days ago.`, { pct: Math.round(-p.tvl7dChange * 100) })

  // возраст пула / протокола
  if (p.createdAt) {
    const days = Math.floor((now - p.createdAt) / DAY)
    if (days < 14) add('high', 'pool_new', `The pool is only ${days} day${days === 1 ? '' : 's'} old.`, { days })
    else if (days < 90) add('medium', 'pool_young', `The pool is ${days} days old.`, { days })
  }
  if (p.protocol) {
    const pr = p.protocol
    if (pr.listedAt) {
      const days = Math.floor((now - pr.listedAt) / DAY)
      if (days < 180) add('medium', 'protocol_young', `${pr.name} has been tracked for only ${days} days.`, { name: pr.name, days })
      else if (days > 730) add('good', 'protocol_old', `${pr.name} has been live since ${dateOf(pr.listedAt).slice(0, 4)}.`, { name: pr.name, year: dateOf(pr.listedAt).slice(0, 4) })
    }
    if (pr.issuer)
      add('info', 'issuer', `The yield is paid by ${pr.name} as a company or fund: the main risk is the issuer, not only the code.`, { name: pr.name })
    else if (pr.audited) add('good', 'audited', `${pr.name} has a public audit.`, { name: pr.name })
    else add('medium', 'no_audit', `No public audit is listed for ${pr.name}.`, { name: pr.name })
    for (const h of (pr.hacks || []).slice(0, 2)) {
      const recent = h.date && now - Date.parse(h.date) < 730 * DAY
      add(recent ? 'high' : 'medium', 'hacked', `${pr.name} was hacked on ${h.date}${h.amount ? ` (${money(h.amount)} lost)` : ''}.`, { name: pr.name, date: h.date, amount: h.amount ? money(h.amount) : '' })
    }
  }

  // откуда доход
  const apy = Number(p.apy) || 0
  const reward = Number(p.apyReward) || 0
  if (apy > 0 && reward / apy > 0.5)
    add('medium', 'reward_based', `Most of the yield (${pct(reward)} of ${pct(apy)}) is paid in reward tokens. Such rewards usually shrink over time and their price can fall.`, { reward: pct(reward), apy: pct(apy) })
  if (apy > 200)
    add('high', 'apy_extreme', `A yield of ${pct(apy)} a year is extreme. It usually means high risk or a short-lived spike.`, { apy: pct(apy) })
  else if (apy > 60)
    add('medium', 'apy_high', `A yield of ${pct(apy)} a year is well above normal. High yield almost always comes with high risk.`, { apy: pct(apy) })
  if (p.feeApr != null && p.feeApr > 60)
    add('medium', 'fee_spike', `This fee income comes from heavy recent trading. If trading slows down, the yield falls with it.`)
  if (p.apyMean30d != null && apy > 20 && apy > 3 * (Number(p.apyMean30d) || 0))
    add('medium', 'apy_jump', `The yield jumped to ${pct(apy)} from a 30-day average of ${pct(p.apyMean30d)}. Jumps like this rarely last.`, { apy: pct(apy), mean: pct(p.apyMean30d) })
  if (p.outlier) add('medium', 'outlier', 'DefiLlama marks this yield as an outlier compared with similar pools.')

  // колебания цен
  if (p.ilRisk && !p.stable)
    add('low', 'il', 'If the prices of the two tokens move apart, you can end up with less than you put in (impermanent loss).')
  if (p.stable) add('good', 'stable', 'Stablecoin position: price swings are small.')

  // токены
  for (const tk of p.tokens || []) {
    const t = (ctx.tokens || {})[tk.address]
    for (const x of tokenReasons(tk.symbol || tk.address.slice(0, 8), t)) r.push(x)
  }

  let score = 100
  for (const x of r) score -= PENALTY[x.level] || 0
  score = Math.max(0, Math.min(100, score))
  const g = GRADES.find(([min]) => score >= min)
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4, good: 5 }
  r.sort((a, b) => order[a.level] - order[b.level])
  return { score, grade: g[1], gradeLabel: g[2], reasons: r }
}

module.exports = { assess, tokenReasons, money, pct, GRADES }
