import type { SlaInfo, SlaLevel } from './types'

/** Decide SLA severity from remaining fraction / breach state. */
export function computeLevel(remainingFraction: number | null, breached: boolean): SlaLevel {
  if (breached) return 'breach'
  if (remainingFraction === null) return 'none'
  if (remainingFraction < 0.1) return 'breach'
  if (remainingFraction < 0.5) return 'warn'
  return 'ok'
}

/** Human readable remaining time, e.g. "2ч 15м" or "просрочено". */
export function formatRemaining(sla: SlaInfo | null): string {
  if (!sla || sla.remainingMs === null) return '—'
  if (sla.breached || sla.remainingMs <= 0) return 'просрочено'
  const totalMin = Math.floor(sla.remainingMs / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  if (days > 0) return `${days}д ${hours}ч`
  if (hours > 0) return `${hours}ч ${mins}м`
  return `${mins}м`
}

/** CSS color token per level — consumed by widget + panel. */
export const LEVEL_COLOR: Record<SlaLevel, string> = {
  none: '#8b95a5',
  ok: '#2ea043',
  warn: '#d29922',
  breach: '#f85149'
}

/** Pick the worst SLA level across a set of issues (drives widget animation). */
export function worstLevel(levels: SlaLevel[]): SlaLevel {
  const order: SlaLevel[] = ['none', 'ok', 'warn', 'breach']
  return levels.reduce<SlaLevel>(
    (worst, l) => (order.indexOf(l) > order.indexOf(worst) ? l : worst),
    'none'
  )
}
