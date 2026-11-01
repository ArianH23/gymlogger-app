import { supabase } from './supabase'

export type ExerciseInfo = {
  id: string
  name: string
  equipment: string | null
  loadType: 'weighted' | 'bodyweight' | 'assisted'
  unilateral: boolean
  dumbbellPair: boolean
}

export type SessionStat = {
  sessionId: string
  startedAt: string
  sets: number
  totalReps: number
  bestReps: number | null
  bestWeightKg: number | null
  est1rmKg: number | null
  bestSetVolumeKg: number | null
  sessionVolumeKg: number | null
}

export type RepsAtWeight = { weightKg: number; reps: number; startedAt: string }

export type LoggedSetRow = {
  sessionId: string
  setNo: number
  side: 'L' | 'R' | null
  weightKg: number | null
  reps: number | null
  isWarmup: boolean
}

export type SessionHistory = { sessionId: string; title: string; startedAt: string; sets: LoggedSetRow[] }

export type ExerciseData = {
  info: ExerciseInfo
  stats: SessionStat[] // oldest first
  repsAtWeight: RepsAtWeight[] // heaviest first
  history: SessionHistory[] // newest first
}

type Num = number | null

/** Everything the exercise page shows. The numbers come from database views (exercise_session_stats and
 * exercise_best_reps_by_weight), so every client computes them identically. Kept on the phone for offline use. */
export async function loadExerciseData(id: string): Promise<{ data: ExerciseData; offline: boolean }> {
  const cacheKey = `gl_exercise_${id}`
  try {
    const [ex, stats, reps, sets] = await Promise.all([
      supabase.from('exercises').select('id, name, equipment, load_type, unilateral, dumbbell_pair').eq('id', id).single(),
      supabase
        .from('exercise_session_stats')
        .select('session_id, started_at, sets, total_reps, best_reps, best_weight_kg, est_1rm_kg, best_set_volume_kg, session_volume_kg')
        .eq('exercise_id', id)
        .order('started_at'),
      supabase.from('exercise_best_reps_by_weight').select('weight_kg, reps, started_at').eq('exercise_id', id).order('weight_kg', { ascending: false }),
      supabase
        .from('sets')
        .select('session_id, set_no, side, weight_kg, reps, is_warmup, sessions!inner(title, started_at, ended_at)')
        .eq('exercise_id', id)
        .is('deleted_at', null)
        .not('sessions.ended_at', 'is', null),
    ])
    for (const r of [ex, stats, reps, sets]) if (r.error) throw r.error

    const info: ExerciseInfo = {
      id: ex.data!.id,
      name: ex.data!.name,
      equipment: ex.data!.equipment,
      loadType: ex.data!.load_type,
      unilateral: ex.data!.unilateral,
      dumbbellPair: ex.data!.dumbbell_pair,
    }
    const statRows: SessionStat[] = (stats.data ?? []).map((s) => ({
      sessionId: s.session_id as string,
      startedAt: s.started_at as string,
      sets: Number(s.sets),
      totalReps: Number(s.total_reps),
      bestReps: s.best_reps as Num,
      bestWeightKg: s.best_weight_kg as Num,
      est1rmKg: s.est_1rm_kg as Num,
      bestSetVolumeKg: s.best_set_volume_kg as Num,
      sessionVolumeKg: s.session_volume_kg as Num,
    }))
    const repsRows: RepsAtWeight[] = (reps.data ?? []).map((r) => ({
      weightKg: r.weight_kg as number,
      reps: r.reps as number,
      startedAt: r.started_at as string,
    }))

    const bySession = new Map<string, SessionHistory>()
    for (const r of (sets.data ?? []) as unknown as {
      session_id: string
      set_no: number
      side: 'L' | 'R' | null
      weight_kg: Num
      reps: Num
      is_warmup: boolean
      sessions: { title: string; started_at: string }
    }[]) {
      const h = bySession.get(r.session_id) ?? { sessionId: r.session_id, title: r.sessions.title, startedAt: r.sessions.started_at, sets: [] }
      h.sets.push({ sessionId: r.session_id, setNo: r.set_no, side: r.side, weightKg: r.weight_kg, reps: r.reps, isWarmup: r.is_warmup })
      bySession.set(r.session_id, h)
    }
    const history = [...bySession.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))

    const data: ExerciseData = { info, stats: statRows, repsAtWeight: repsRows, history }
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data))
    } catch {
      // storage full: the page still works, just not offline
    }
    return { data, offline: false }
  } catch (e) {
    const saved = localStorage.getItem(cacheKey)
    if (saved) return { data: JSON.parse(saved) as ExerciseData, offline: true }
    throw e
  }
}

export type MetricId = 'weight' | 'oneRm' | 'setVolume' | 'sessionVolume' | 'bestReps' | 'totalReps'

export type Metric = {
  id: MetricId
  label: string
  lowerIsBetter?: boolean
  value: (s: SessionStat) => number | null
  /** unit text after the number */
  unit: 'kg' | 'reps'
}

const weightMetrics = (assisted: boolean): Metric[] => [
  {
    id: 'weight',
    label: assisted ? 'Assistance' : 'Heaviest weight',
    lowerIsBetter: assisted,
    value: (s) => s.bestWeightKg,
    unit: 'kg',
  },
]

/** The metrics offered for an exercise. Weighted: weight, 1RM, set volume, session volume.
 * Assisted: assistance and reps (weight x reps means nothing when the weight helps you). Bodyweight: reps only. */
export function metricsFor(info: ExerciseInfo): Metric[] {
  const reps: Metric[] = [
    { id: 'bestReps', label: 'Best reps', value: (s) => s.bestReps, unit: 'reps' },
    { id: 'totalReps', label: 'Total reps', value: (s) => s.totalReps, unit: 'reps' },
  ]
  if (info.loadType === 'weighted') {
    return [
      ...weightMetrics(false),
      { id: 'oneRm', label: 'Est. 1RM', value: (s) => s.est1rmKg, unit: 'kg' },
      { id: 'setVolume', label: 'Best set volume', value: (s) => s.bestSetVolumeKg, unit: 'kg' },
      { id: 'sessionVolume', label: 'Session volume', value: (s) => s.sessionVolumeKg, unit: 'kg' },
    ]
  }
  if (info.loadType === 'assisted') return [...weightMetrics(true), ...reps]
  return reps
}

export type Record = { label: string; value: number; unit: 'kg' | 'reps'; startedAt: string; pair?: boolean }

/** Personal bests, from the per-session numbers. */
export function recordsFor(info: ExerciseInfo, stats: SessionStat[]): Record[] {
  const best = (label: string, pick: (s: SessionStat) => number | null, unit: 'kg' | 'reps', lower = false, pair = false): Record | null => {
    let top: { v: number; s: SessionStat } | null = null
    for (const s of stats) {
      const v = pick(s)
      if (v === null) continue
      if (!top || (lower ? v < top.v : v > top.v)) top = { v, s }
    }
    return top ? { label, value: top.v, unit, startedAt: top.s.startedAt, pair } : null
  }
  const out =
    info.loadType === 'weighted'
      ? [
          best('Heaviest weight', (s) => s.bestWeightKg, 'kg', false, info.dumbbellPair),
          best('Best est. 1RM', (s) => s.est1rmKg, 'kg', false, info.dumbbellPair),
          best('Best set volume', (s) => s.bestSetVolumeKg, 'kg'),
          best('Best session volume', (s) => s.sessionVolumeKg, 'kg'),
        ]
      : info.loadType === 'assisted'
        ? [best('Lowest assistance', (s) => s.bestWeightKg, 'kg', true), best('Most reps in a set', (s) => s.bestReps, 'reps')]
        : [best('Most reps in a set', (s) => s.bestReps, 'reps'), best('Most reps in a session', (s) => s.totalReps, 'reps')]
  return out.filter((r): r is Record => r !== null)
}
