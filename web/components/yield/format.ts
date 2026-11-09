// Общие подписи для страниц NeroX Yield
export const GRADE_STYLE: Record<string, string> = {
  A: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10',
  B: 'text-lime-300 border-lime-300/40 bg-lime-300/10',
  C: 'text-amber-300 border-amber-300/40 bg-amber-300/10',
  D: 'text-orange-400 border-orange-400/40 bg-orange-400/10',
  E: 'text-[#F91155] border-[#F91155]/40 bg-[#F91155]/10',
}


export function money(x: number | null | undefined): string {
  const v = Number(x) || 0
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`
  return `$${Math.round(v)}`
}
export function pct(x: number | null | undefined): string {
  if (x === null || x === undefined || isNaN(Number(x))) return '—'
  const v = Number(x)
  return v >= 100 ? `${Math.round(v)}%` : v >= 10 ? `${v.toFixed(1)}%` : `${v.toFixed(2)}%`
}
