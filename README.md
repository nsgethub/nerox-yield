# NeroX Yield

Yield and risk of BNB Chain pools in one list, with a plain-language reason for every risk grade.

Live: https://neroxcoin.org/yield (free, no sign-up, 8 languages).

This repository holds the code that runs that page: data collection, the A–E risk grade, the API and the web pages.
The scanner, the risk rules, the API routes and the pages are the same files that run on the live server.

NeroX Yield shows data and rule-based checks. It is not financial advice and it does not promise any return.

## How it works

Once an hour the scanner collects BNB Chain pools from public sources, checks them and saves one snapshot.

| Source | What is taken |
|---|---|
| [DefiLlama](https://defillama.com/yields) | BNB Chain pools with at least $100K in them, yield, rewards, 30-day average; protocol age, audits, category; known hacks |
| [DexPaprika](https://dexpaprika.com) | Up to 100 PancakeSwap v3 and 100 v2 pools with at least $100K: liquidity, trading volume, creation date |
| BNB Chain RPC | Fee tier of each PancakeSwap v3 pool, token symbols |
| [GoPlus](https://gopluslabs.io) | Token safety: honeypot, taxes, owner rights, hidden owner, number of holders |

For PancakeSwap pools the yield is estimated from trading fees:

```
fee APR = (7-day volume / 7) × fee tier × LP share × 365 / liquidity
```

LP share is the part of the fee paid to liquidity providers: 67% for 0.01%, 66% for 0.05%, 68% for 0.25% and 1% pools ([PancakeSwap docs](https://docs.pancakeswap.finance)).

The 7-day outflow check uses the scanner's own daily snapshots of pool size.

## Risk grade

Every pool starts with 100 points. Each finding takes points away:

| Level | Points |
|---|---|
| critical | −100 |
| high | −25 |
| medium | −10 |
| low | −4 |
| info, good | 0 (shown to the user, no penalty) |

| Score | Grade |
|---|---|
| 85–100 | A: low risk |
| 70–84 | B: moderate risk |
| 50–69 | C: elevated risk |
| 30–49 | D: high risk |
| 0–29 | E: very high risk |

### Rules

Pool size and money flow
- under $250K: high; under $1M: medium; $50M and more: good
- 30% or more money left the pool in 7 days: high

Age
- pool younger than 14 days: high; younger than 90 days: medium
- protocol tracked by DefiLlama for less than 180 days: medium; more than 2 years: good

Protocol
- yield paid by a company or fund (RWA, CeDeFi, basis trading and similar): info, the main risk is the issuer
- public audit: good; no public audit: medium
- hack in the last 2 years: high; older hack: medium

Where the yield comes from
- more than half of the yield paid in reward tokens: medium
- yield above 100% a year: high; above 30%: medium
- PancakeSwap fee yield above 30%: medium (depends on recent heavy trading)
- yield above 20% and more than 3× its 30-day average: medium
- DefiLlama marks the yield as an outlier: medium

Price
- two tokens that can move apart (impermanent loss): low
- stablecoin position: good

Tokens (GoPlus)
- cannot be sold (honeypot), hidden owner, owner can change balances: critical
- cannot be bought freely, tax 10% or more, owner can take back control, contract can destroy itself, code not published: high
- tax above 1%: medium
- tokens not on the GoPlus trust list also get: owner can create tokens, code can be replaced, transfers can be paused (medium); owner can block addresses (low); owner can change the tax (high); fewer than 300 holders (medium)
- check not done yet: info

Well-known tokens (USDT, WBNB and others on the GoPlus trust list) are not penalised for owner rights, because that is how their issuers run them.

All rules are in [`src/services/yieldRisk.js`](src/services/yieldRisk.js).

## On-chain grades

Once a day the grades are written to BNB Smart Chain, so anyone can read them for free and check that past grades were not changed.

- Contract: [`0xA187f9168696D763e8700Db128517BCe04C61f23`](https://bscscan.com/address/0xA187f9168696D763e8700Db128517BCe04C61f23#code) (source verified on BscScan)
- Source: [`contracts/NeroXYieldGrades.sol`](contracts/NeroXYieldGrades.sol)
- Each daily `Grades` event carries the pools whose grade changed, 22 bytes each: 20-byte pool key, grade letter (`A`..`E`, 0 = removed), score 0..100.
- Pool key: the pool address, or the DefiLlama pool UUID followed by 4 zero bytes.
- `lastHash` is the keccak256 of the full packed list (sorted by key), so a list rebuilt from the events can be checked against it.

## For AI agents

The same data is available to AI agents over [MCP](https://modelcontextprotocol.io) (JSON-RPC over HTTP POST, free, no key):

- Endpoint: `https://api.neroxcoin.org/api/agent/mcp`
- Tools: `list_pools` (filter by worst allowed grade, stablecoin-only, size, yield) and `get_pool_risk` (full report with every reason for one pool)
- ERC-8004 identity: agent **416550** in the BNB Smart Chain Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Registration file: `https://api.neroxcoin.org/api/agent/registration.json`

Code: [`src/routes/agent.js`](src/routes/agent.js)

## API

The live API is open: `https://api.neroxcoin.org/api/yield/...`

| Endpoint | Returns |
|---|---|
| `GET /api/yield/pools` | Pool list. Options: `view=all\|stable\|safer\|pancakeswap`, `sort=tvl\|apy\|risk`, `q=` search, `limit=` (up to 500), `zero=1` to include pools paying under 0.1% |
| `GET /api/yield/pool/:id` | One pool with all reasons |
| `GET /api/yield/status` | Time of the last snapshot and grade counts |

## Run it yourself

Needs Node.js 20+ and Redis.

```
npm install
REDIS_HOST=127.0.0.1 npm start      # API on http://localhost:4000
npm run scan                         # one scan without Redis, prints the result
npm test                             # risk grade tests, no network needed
```

Settings: `PORT`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASS`. No API keys are needed: all sources are public.

## Files

```
src/server.js               API server
src/routes/yield.js         API routes
src/routes/agent.js         MCP endpoint and ERC-8004 registration file for AI agents
src/services/yieldScan.js   hourly data collection
src/services/yieldRisk.js   risk grade rules
src/services/redis.js       snapshot storage
scripts/scan-once.js        one scan from the command line
test/                       tests for the risk grade
contracts/                  on-chain contract for daily grades
web/                        Next.js pages of neroxcoin.org/yield and their 8-language texts
```

The pages in `web/` are part of the NeroX site and use its header and footer, so they do not build on their own.

## Limits

- Data comes from third parties and can be late or wrong. Check the pool on the protocol's own site before you deposit.
- GoPlus is checked gradually, up to 80 new tokens per hour, so a new token may show "check pending".
- The grade is a set of simple rules, not an audit of the contracts.

## License

No license has been chosen yet. Until then all rights are reserved by the NeroX authors.
