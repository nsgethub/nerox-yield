import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/landing/Footer'
import { money, pct, GRADE_STYLE } from '@/components/yield/format'
import { LANGS, langOf, t, reason, kind, withLang } from '@/components/yield/i18n'

// Страница одного пула: доход, откуда он, оценка риска со всеми причинами.
// Язык: ?lang=xx в адресе, иначе выбранный на сайте (middleware → x-nx-lang).
export const revalidate = 600

interface Reason { level: string; key: string; text: string; p?: Record<string, string | number> }
interface Pool {
  id: string; source: string; project: string; protocolName: string; category: string; kind: string; name: string
  tokens: { address: string; symbol: string }[]; tvl: number; apy: number | null; apyBase: number | null
  apyReward: number | null; apyMean30d: number | null; feeApr: number | null; fee: number | null; stable: boolean
  ilRisk: boolean; trend: string | null; volume24h: number | null; tvl7dChange: number | null; createdAt: number | null
  url: string; site: string; score: number; grade: string; gradeLabel: string; reasons: Reason[]
}
interface Data { at: number; sources: string[]; pool: Pool }

type Props = { params: { id: string }; searchParams: { lang?: string } }

// язык из адреса ('' если не указан) и язык показа
function langs(q?: string): [string, string] {
  const v = String(q || '').toLowerCase()
  const url = LANGS.some(([k]) => k === v) ? v : ''
  return [url, url || langOf(headers().get('x-nx-lang') || '')]
}

const LEVEL: Record<string, string> = {
  critical: 'text-[#F91155]',
  high: 'text-orange-400',
  medium: 'text-amber-300',
  low: 'text-gray-300',
  info: 'text-gray-400',
  good: 'text-emerald-400',
}

async function load(id: string): Promise<Data | null> {
  if (!/^[0-9a-zA-Z-]{8,80}$/.test(id)) return null
  const bases = ['http://nerox_backend:4000', process.env.NEXT_PUBLIC_API_URL || 'https://api.neroxcoin.org']
  for (const base of bases) {
    try {
      const r = await fetch(`${base}/api/yield/pool/${id}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(20000) })
      if (r.status === 404) return null
      if (r.ok) return (await r.json()) as Data
    } catch (e) {
      // следующий адрес
    }
  }
  return null
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const d = await load(params.id)
  if (!d) return { title: 'Pool not found', robots: { index: false, follow: true } }
  const [urlLang, lang] = langs(searchParams.lang)
  const p = d.pool
  const vars = { name: p.name, protocol: p.protocolName, apy: pct(p.apy), tvl: money(p.tvl), g: p.grade }
  const title = t(lang, 'd_title', vars)
  const description = t(lang, 'd_desc', vars)
  const url = withLang(`/yield/${p.id}`, urlLang || 'en')
  const languages: Record<string, string> = { 'x-default': `/yield/${p.id}` }
  for (const [k] of LANGS) languages[k] = withLang(`/yield/${p.id}`, k)
  return {
    title: { absolute: `${title} | NeroX Yield` },
    description,
    alternates: { canonical: url, languages },
    openGraph: { title, description, url, siteName: 'NeroX', type: 'website', images: ['/og-image.png'] },
    twitter: { card: 'summary_large_image', title, description, images: ['/og-image.png'] },
  }
}

export default async function PoolPage({ params, searchParams }: Props) {
  const d = await load(params.id)
  if (!d) notFound()
  const lang = langs(searchParams.lang)[1]
  const p = d.pool
  const say = (r: Reason) => reason(lang, r.key, r.p, r.text)
  const when = new Date(d.at)
  const age = p.createdAt ? Math.floor((d.at - p.createdAt) / 86400000) : null
  const risks = p.reasons.filter(r => r.level !== 'good')
  const good = p.reasons.filter(r => r.level === 'good')
  const facts: [string, string][] = [
    [t(lang, 'f_apy'), pct(p.apy)],
    [t(lang, 'f_base'), pct(p.apyBase)],
    [t(lang, 'f_reward'), p.apyReward ? pct(p.apyReward) : '—'],
    [t(lang, 'f_mean'), pct(p.apyMean30d)],
    [t(lang, 'f_tvl'), money(p.tvl)],
    [t(lang, 'f_change'), p.tvl7dChange === null || p.tvl7dChange === undefined ? '—' : `${(p.tvl7dChange * 100).toFixed(1)}%`],
    [t(lang, 'f_vol'), p.volume24h ? money(p.volume24h) : '—'],
    [t(lang, 'f_fee'), p.fee ? `${p.fee / 1e4}%` : '—'],
    [t(lang, 'f_age'), age === null ? '—' : t(lang, 'days', { n: age })],
    [t(lang, 'f_type'), kind(lang, p.kind)],
  ]

  return (
    <div className="min-h-screen bg-[#050508]">
      <Navbar />
      <main lang={lang} className="max-w-3xl mx-auto px-4 pt-28 pb-16">
        <nav aria-label={t(lang, 'lang')} className="flex flex-wrap gap-x-3 gap-y-1 mb-4 text-[11px] font-mono">
          {LANGS.map(([k, name]) => (
            <a key={k} href={`/yield/${p.id}?lang=${k}`} hrefLang={k} lang={k}
              className={k === lang ? 'text-white' : 'text-gray-500 hover:text-gray-300'}>
              {name}
            </a>
          ))}
        </nav>
        <Link href={withLang('/yield', lang)} className="text-xs font-mono text-gray-500 hover:text-white">{t(lang, 'back')}</Link>
        <p className="text-xs font-mono text-[#005BFF] mt-4 mb-2">{p.protocolName} · BNB Chain</p>
        <h1 className="font-orbitron font-bold text-white text-2xl md:text-3xl mb-3 break-words">{p.name}</h1>
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className={`text-sm font-mono px-3 py-1 border ${GRADE_STYLE[p.grade] || ''}`}>{t(lang, 'risk', { g: p.grade, label: t(lang, `g_${p.grade}`) })}</span>
          <span className="text-sm font-mono text-white">{t(lang, 'a_year', { apy: pct(p.apy) })}</span>
          <span className="text-sm font-mono text-gray-400">{t(lang, 'in_pool', { tvl: money(p.tvl) })}</span>
        </div>

        <div className="bg-[#08080f] border border-white/10 mb-6">
          <h2 className="text-[11px] font-mono text-[#005BFF] uppercase px-4 pt-3">{t(lang, 'wrong')}</h2>
          {risks.length ? (
            <ul className="divide-y divide-white/5">
              {risks.map((r, i) => (
                <li key={i} className="px-4 py-2.5 grid grid-cols-[72px_1fr] gap-3">
                  <span className={`text-[11px] font-mono uppercase pt-0.5 ${LEVEL[r.level] || LEVEL.info}`}>{t(lang, `l_${LEVEL[r.level] ? r.level : 'info'}`)}</span>
                  <span className="text-sm text-gray-200 leading-relaxed">{say(r)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-3 text-sm text-gray-400">{t(lang, 'none')}</p>}
          {good.length > 0 && (
            <>
              <h2 className="text-[11px] font-mono text-emerald-400 uppercase px-4 pt-3 border-t border-white/5">{t(lang, 'solid')}</h2>
              <ul className="px-4 py-2 space-y-1">
                {good.map((r, i) => <li key={i} className="text-sm text-gray-300">{say(r)}</li>)}
              </ul>
            </>
          )}
        </div>

        <div className="bg-[#08080f] border border-white/10 grid grid-cols-2 sm:grid-cols-3 gap-px">
          {facts.map(([k, v]) => (
            <div key={k} className="px-4 py-3 bg-[#08080f]">
              <div className="text-[10px] font-mono text-gray-500 uppercase">{k}</div>
              <div className="text-sm font-mono text-white mt-0.5">{v}</div>
            </div>
          ))}
        </div>

        {p.tokens.length > 0 && (
          <div className="mt-6 text-xs font-mono text-gray-500 space-y-1">
            {p.tokens.map(t => (
              <div key={t.address}>
                {t.symbol}: <a className="text-gray-400 hover:text-white break-all" href={`https://bscscan.com/token/${t.address}`} target="_blank" rel="noopener noreferrer nofollow">{t.address}</a>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mt-8">
          {p.url && (
            <a href={p.url} target="_blank" rel="noopener noreferrer nofollow"
              className="clip-btn border border-white/15 hover:border-white/40 text-white font-orbitron font-bold text-xs tracking-widest uppercase px-6 py-3 transition-all">
              {t(lang, 'btn_source')}
            </a>
          )}
          {p.site && (
            <a href={p.site} target="_blank" rel="noopener noreferrer nofollow"
              className="clip-btn border border-white/15 hover:border-white/40 text-white font-orbitron font-bold text-xs tracking-widest uppercase px-6 py-3 transition-all">
              {t(lang, 'btn_site', { name: p.protocolName })}
            </a>
          )}
        </div>

        <p className="text-xs font-mono text-gray-500 mt-6">
          {t(lang, 'updated_from', { date: when.toISOString().slice(0, 10), time: when.toISOString().slice(11, 16), sources: d.sources.join(', ') })}{' '}
          {t(lang, 'disclaimer')}
        </p>
      </main>
      <Footer />
    </div>
  )
}
