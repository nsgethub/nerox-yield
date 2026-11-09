import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/landing/Footer'
import { money, pct, GRADE_STYLE } from '@/components/yield/format'
import { LANGS, langOf, t, reason, kind, withLang } from '@/components/yield/i18n'

// NeroX Yield: где на BNB Chain можно заработать на хранении крипты, откуда доход и чем рискуешь.
// Рисуется на сервере (текст видят поисковики), данные обновляются раз в час.
// Язык: ?lang=xx в адресе, иначе выбранный на сайте (middleware → x-nx-lang).
export const revalidate = 600

interface Row {
  id: string; name: string; protocolName: string; kind: string; source: string
  tvl: number; apy: number | null; apyBase: number | null; apyReward: number | null; stable: boolean
  grade: string; gradeLabel: string; score: number; top: string; tvl7dChange: number | null
  topKey?: string; topP?: Record<string, string | number>
}
interface Data { at: number; total: number; all: number; hidden?: number; grades: Record<string, number>; sources: string[]; pools: Row[] }
type SP = { view?: string; sort?: string; lang?: string; zero?: string }

const VIEWS: [string, string][] = [['all', 'v_all'], ['safer', 'v_safer'], ['stable', 'v_stable'], ['pancakeswap', 'v_cake']]
const SORTS: [string, string][] = [['tvl', 's_tvl'], ['apy', 's_apy'], ['risk', 's_risk']]

// язык из адреса ('' если не указан) и язык показа
function langs(q?: string): [string, string] {
  const v = String(q || '').toLowerCase()
  const url = LANGS.some(([k]) => k === v) ? v : ''
  return [url, url || langOf(headers().get('x-nx-lang') || '')]
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const [urlLang, lang] = langs(searchParams.lang)
  const title = t(lang, 'meta_title')
  const description = t(lang, 'meta_desc')
  const url = withLang('/yield', urlLang || 'en')
  const languages: Record<string, string> = { 'x-default': '/yield' }
  for (const [k] of LANGS) languages[k] = withLang('/yield', k)
  return {
    title: { absolute: `${title} | NeroX Yield` },
    description,
    alternates: { canonical: url, languages },
    openGraph: { title, description, url, siteName: 'NeroX', type: 'website', images: ['/og-image.png'] },
    twitter: { card: 'summary_large_image', title, description, images: ['/og-image.png'] },
  }
}

async function load(qs: string): Promise<Data | null> {
  const bases = ['http://nerox_backend:4000', process.env.NEXT_PUBLIC_API_URL || 'https://api.neroxcoin.org']
  for (const base of bases) {
    try {
      const r = await fetch(`${base}/api/yield/pools?${qs}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(20000) })
      if (r.ok) return (await r.json()) as Data
    } catch (e) {
      // следующий адрес
    }
  }
  return null
}

export default async function YieldPage({ searchParams }: { searchParams: SP }) {
  const lang = langs(searchParams.lang)[1]
  const view = VIEWS.some(([k]) => k === searchParams.view) ? String(searchParams.view) : 'all'
  const sort = SORTS.some(([k]) => k === searchParams.sort) ? String(searchParams.sort) : 'tvl'
  const zero = searchParams.zero === '1'
  const d = await load(`view=${view}&sort=${sort}&limit=300${zero ? '&zero=1' : ''}`)
  const when = d ? new Date(d.at) : null
  const link = (v: string, s: string, z: boolean, l: string) => {
    const q = [v !== 'all' ? `view=${v}` : '', s !== 'tvl' ? `sort=${s}` : '', z ? 'zero=1' : ''].filter(Boolean).join('&')
    return withLang(q ? `/yield?${q}` : '/yield', l)
  }

  return (
    <div className="min-h-screen bg-[#050508]">
      <Navbar />
      <main lang={lang} className="max-w-5xl mx-auto px-4 pt-28 pb-16">
        <nav aria-label={t(lang, 'lang')} className="flex flex-wrap gap-x-3 gap-y-1 mb-4 text-[11px] font-mono">
          {LANGS.map(([k, name]) => {
            const base = link(view, sort, zero, 'en')
            return (
              <a key={k} href={`${base}${base.includes('?') ? '&' : '?'}lang=${k}`} hrefLang={k} lang={k}
                className={k === lang ? 'text-white' : 'text-gray-500 hover:text-gray-300'}>
                {name}
              </a>
            )
          })}
        </nav>
        <p className="text-xs font-mono text-[#005BFF] mb-3">{t(lang, 'eyebrow')}</p>
        <h1 className="font-orbitron font-bold text-white text-2xl md:text-3xl mb-3">{t(lang, 'h1')}</h1>
        <p className="text-sm text-gray-400 leading-relaxed mb-6 max-w-3xl">
          {t(lang, 'intro')}
          {when && ` ${t(lang, 'updated', { date: when.toISOString().slice(0, 10), time: when.toISOString().slice(11, 16) })}`}
        </p>

        <div className="flex flex-wrap gap-2 mb-3">
          {VIEWS.map(([k, key]) => (
            <Link key={k} href={link(k, sort, zero, lang)}
              className={`text-xs font-mono px-3 py-1.5 border ${k === view ? 'border-[#005BFF] text-white bg-[#005BFF]/15' : 'border-white/10 text-gray-400 hover:text-white'}`}>
              {t(lang, key)}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {SORTS.map(([k, key]) => (
            <Link key={k} href={link(view, k, zero, lang)}
              className={`text-[11px] font-mono px-2.5 py-1 border ${k === sort ? 'border-white/40 text-white' : 'border-white/5 text-gray-500 hover:text-gray-300'}`}>
              {t(lang, key)}
            </Link>
          ))}
          {d && <span className="text-[11px] font-mono text-gray-500 px-2 py-1">{t(lang, 'count', { n: d.total, all: d.all })}</span>}
        </div>
        {d && (zero || (d.hidden || 0) > 0) && (
          <p className="text-[11px] font-mono text-gray-500 mb-6">
            {zero ? '' : `${t(lang, 'hidden', { n: d.hidden || 0 })} `}
            <Link href={link(view, sort, !zero, lang)} className="text-gray-300 underline hover:text-white">
              {t(lang, zero ? 'hide' : 'show')}
            </Link>
          </p>
        )}
        {d && !(zero || (d.hidden || 0) > 0) && <div className="mb-6" />}

        {d ? (
          <div className="bg-[#08080f] border border-white/10 divide-y divide-white/5">
            <div className="hidden md:grid grid-cols-[1fr_120px_110px_150px] gap-3 px-4 py-2 text-[10px] font-mono text-gray-500 uppercase">
              <span>{t(lang, 'col_pool')}</span><span className="text-right">{t(lang, 'col_yield')}</span>
              <span className="text-right">{t(lang, 'col_tvl')}</span><span>{t(lang, 'col_risk')}</span>
            </div>
            {d.pools.map(p => {
              const top = reason(lang, p.topKey || '', p.topP, p.top)
              return (
                <Link key={p.id} href={withLang(`/yield/${p.id}`, lang)} className="block px-4 py-3 hover:bg-white/[0.03]">
                  <div className="grid grid-cols-2 md:grid-cols-[1fr_120px_110px_150px] gap-x-3 gap-y-1 items-start">
                    <div className="col-span-2 md:col-span-1 min-w-0">
                      <div className="text-sm text-white font-semibold truncate">{p.name}</div>
                      <div className="text-[11px] text-gray-500 truncate">{p.protocolName} · {kind(lang, p.kind)}</div>
                    </div>
                    <div className="md:text-right">
                      <div className="text-sm font-mono text-white">{pct(p.apy)}</div>
                      <div className="text-[10px] font-mono text-gray-500">
                        {p.apyReward ? t(lang, 'split', { base: pct(p.apyBase || 0), reward: pct(p.apyReward) }) : t(lang, 'from_fees')}
                      </div>
                    </div>
                    <div className="text-right text-sm font-mono text-gray-300">{money(p.tvl)}</div>
                    <div className="col-span-2 md:col-span-1">
                      <span className={`inline-block text-[11px] font-mono px-2 py-0.5 border ${GRADE_STYLE[p.grade] || ''}`}>
                        {p.grade} · {t(lang, `g_${p.grade}`)}
                      </span>
                    </div>
                  </div>
                  {top && <p className="text-[12px] text-gray-400 mt-1.5 leading-snug">{top}</p>}
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="bg-[#08080f] border border-white/10 px-4 py-6 text-sm text-gray-400">{t(lang, 'preparing')}</div>
        )}

        <div className="mt-8 grid md:grid-cols-2 gap-4 text-sm text-gray-400 leading-relaxed">
          <div className="bg-[#08080f] border border-white/5 p-4">
            <h2 className="text-xs font-mono text-[#005BFF] uppercase mb-2">{t(lang, 'how_t')}</h2>
            <p>{t(lang, 'how')}</p>
          </div>
          <div className="bg-[#08080f] border border-white/5 p-4">
            <h2 className="text-xs font-mono text-[#005BFF] uppercase mb-2">{t(lang, 'src_t')}</h2>
            <p>{t(lang, 'src')}</p>
          </div>
        </div>
        <p className="text-xs font-mono text-gray-500 mt-4">{t(lang, 'disclaimer')}</p>
      </main>
      <Footer />
    </div>
  )
}
