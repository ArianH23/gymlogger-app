/** Number without trailing zeros: 44, 7.5, 24.5 */
export const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(Number(Number(n).toFixed(2))))

/** "24 kg (2×12)" for dumbbell pairs, "40 kg" otherwise, "50 kg assist" for assisted exercises. */
export function kgText(weight: number | null, ex: { dumbbellPair: boolean; loadType: string }) {
  if (weight === null) return 'bodyweight'
  if (ex.loadType === 'assisted') return `${num(weight)} kg assist`
  return ex.dumbbellPair ? `${num(weight)} kg (2×${num(weight / 2)})` : `${num(weight)} kg`
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export const formatDayMonth = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** "44 kg (2×22) × 7-10": a planned set's target. */
export function targetText(
  set: { weightKg: number | null; repsMin: number | null; repsMax: number | null } | undefined,
  ex: { dumbbellPair: boolean; loadType: string },
) {
  if (!set) return ''
  const reps =
    set.repsMin === null ? '' : set.repsMax === null || set.repsMax === set.repsMin ? `${set.repsMin}` : `${set.repsMin}-${set.repsMax}`
  const weight = set.weightKg === null ? '' : kgText(set.weightKg, ex)
  return [weight, reps && `× ${reps}`].filter(Boolean).join(' ')
}

/** "today", "yesterday", "5 days ago", "3 weeks ago" */
export function daysAgo(iso: string) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}
