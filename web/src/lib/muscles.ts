import { supabase } from './supabase'

// Which muscles a workout hit. The tags, the 1-per-set / 0.5-per-set weighting, and the sums per session, week and month
// are computed in the database (views session_muscles, weekly_muscles, monthly_muscles); this file only reads them.

/** Same keys and order as the database function muscle_defs(). */
export const MUSCLES = [
  { key: 'chest', label: 'Chest' },
  { key: 'front_delts', label: 'Front delts' },
  { key: 'side_delts', label: 'Side delts' },
  { key: 'rear_delts', label: 'Rear delts' },
  { key: 'lats', label: 'Lats' },
  { key: 'upper_back', label: 'Upper back' },
  { key: 'lower_back', label: 'Lower back' },
  { key: 'biceps', label: 'Biceps' },
  { key: 'triceps', label: 'Triceps' },
  { key: 'forearms', label: 'Forearms' },
  { key: 'abs', label: 'Abs' },
  { key: 'glutes', label: 'Glutes' },
  { key: 'quads', label: 'Quads' },
  { key: 'hamstrings', label: 'Hamstrings' },
  { key: 'adductors', label: 'Adductors' },
  { key: 'calves', label: 'Calves' },
] as const

export type MuscleKey = (typeof MUSCLES)[number]['key']

export const muscleLabel = (key: string) => MUSCLES.find((m) => m.key === key)?.label ?? key

/** One muscle's weighted sets (primary 1, secondary 0.5 per working set) and its share of the total. */
export type MuscleRow = { muscle: string; label: string; sets: number; share: number }

/** One comparison of two sides of the body (push against pull, say): the weighted sets on each side. From weekly_balance / monthly_balance. */
export type BalanceRow = { pair: string; label: string; aLabel: string; bLabel: string; aSets: number; bSets: number; aShare: number }

export type PeriodKind = 'week' | 'month'
export type MusclePeriod = { start: string; rows: MuscleRow[]; total: number; balance: BalanceRow[] }

const bySets = (a: MuscleRow, b: MuscleRow) => b.sets - a.sets || a.label.localeCompare(b.label)

/** The muscles one finished session hit, most sets first. Empty if it has no tagged exercise. */
export async function loadSessionMuscles(sessionId: string): Promise<MuscleRow[]> {
  const { data, error } = await supabase.from('session_muscles').select('muscle, label, sets, share').eq('session_id', sessionId)
  if (error) throw error
  return (data ?? []).map((r) => ({ muscle: r.muscle as string, label: r.label as string, sets: Number(r.sets), share: Number(r.share) })).sort(bySets)
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The last 26 weeks or 24 months, newest first; only periods with at least one tagged set. */
export async function loadMusclePeriods(kind: PeriodKind): Promise<MusclePeriod[]> {
  const view = kind === 'week' ? 'weekly_muscles' : 'monthly_muscles'
  const col = kind === 'week' ? 'week_start' : 'month_start'
  const from = new Date()
  if (kind === 'week') from.setDate(from.getDate() - 26 * 7)
  else from.setMonth(from.getMonth() - 24)
  const balanceView = kind === 'week' ? 'weekly_balance' : 'monthly_balance'
  const [{ data, error }, balance] = await Promise.all([
    supabase.from(view).select(`${col}, muscle, label, sets, share`).gte(col, isoDay(from)).order(col, { ascending: false }),
    supabase.from(balanceView).select(`${col}, pair, label, ord, a_label, b_label, a_sets, b_sets, a_share`).gte(col, isoDay(from)).order('ord'),
  ])
  if (error) throw error
  if (balance.error) throw balance.error
  const periods = new Map<string, MusclePeriod>()
  for (const r of (data ?? []) as unknown as Record<string, string | number>[]) {
    const start = r[col] as string
    const p = periods.get(start) ?? { start, rows: [], total: 0, balance: [] }
    p.rows.push({ muscle: r.muscle as string, label: r.label as string, sets: Number(r.sets), share: Number(r.share) })
    p.total += Number(r.sets)
    periods.set(start, p)
  }
  for (const r of (balance.data ?? []) as unknown as Record<string, string | number>[]) {
    const b: BalanceRow = { pair: r.pair as string, label: r.label as string, aLabel: r.a_label as string, bLabel: r.b_label as string, aSets: Number(r.a_sets), bSets: Number(r.b_sets), aShare: Number(r.a_share) }
    periods.get(r[col] as string)?.balance.push(b)
  }
  return [...periods.values()].map((p) => ({ ...p, rows: p.rows.sort(bySets) })).sort((a, b) => b.start.localeCompare(a.start))
}

export type ExerciseMuscle = { muscle: string; role: 'primary' | 'secondary' }

/** The muscle tags of every exercise, by exercise id (about 170 small rows). Saved on the phone so a workout can show them offline. */
export async function loadExerciseMuscles(): Promise<Record<string, ExerciseMuscle[]>> {
  try {
    const { data, error } = await supabase.from('exercise_muscles').select('exercise_id, muscle, role')
    if (error) throw error
    const out: Record<string, ExerciseMuscle[]> = {}
    for (const r of data ?? []) (out[r.exercise_id as string] ??= []).push({ muscle: r.muscle as string, role: r.role as 'primary' | 'secondary' })
    for (const list of Object.values(out)) list.sort((a, b) => (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1))
    try {
      localStorage.setItem('gl_exercise_muscles', JSON.stringify(out))
    } catch {
      // storage full: it still works online
    }
    return out
  } catch (e) {
    const saved = localStorage.getItem('gl_exercise_muscles')
    if (saved) return JSON.parse(saved) as Record<string, ExerciseMuscle[]>
    throw e
  }
}
