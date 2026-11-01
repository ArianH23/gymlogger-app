import { supabase } from './supabase'

export type ExerciseRow = {
  id: string
  name: string
  equipment: string | null
  loadType: 'weighted' | 'bodyweight' | 'assisted'
  unilateral: boolean
  dumbbellPair: boolean
  sessions: number
  lastPerformedAt: string | null
  bestWeightKg: number | null
}

/** All exercises with their summary numbers. Kept on the phone, so lists and pickers work without signal. */
export async function loadExerciseList(): Promise<{ rows: ExerciseRow[]; offline: boolean } | null> {
  try {
    const [ex, summary] = await Promise.all([
      supabase.from('exercises').select('id, name, equipment, load_type, unilateral, dumbbell_pair').is('deleted_at', null),
      supabase.from('exercise_summary').select('exercise_id, sessions, last_performed_at, best_weight_kg'),
    ])
    if (ex.error) throw ex.error
    if (summary.error) throw summary.error
    const byId = new Map((summary.data ?? []).map((s) => [s.exercise_id as string, s]))
    const rows = (ex.data ?? []).map((e) => {
      const s = byId.get(e.id)
      return {
        id: e.id,
        name: e.name,
        equipment: e.equipment,
        loadType: e.load_type,
        unilateral: e.unilateral,
        dumbbellPair: e.dumbbell_pair,
        sessions: Number(s?.sessions ?? 0),
        lastPerformedAt: (s?.last_performed_at as string | null) ?? null,
        bestWeightKg: (s?.best_weight_kg as number | null) ?? null,
      } satisfies ExerciseRow
    })
    localStorage.setItem('gl_exercises', JSON.stringify(rows))
    return { rows, offline: false }
  } catch {
    const saved = localStorage.getItem('gl_exercises')
    return saved ? { rows: JSON.parse(saved) as ExerciseRow[], offline: true } : null
  }
}

/** Most recently done first, then the ones never done, alphabetically. */
export function sortAndFilter(rows: ExerciseRow[], query: string) {
  const q = query.trim().toLowerCase()
  return rows
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => (b.lastPerformedAt ?? '').localeCompare(a.lastPerformedAt ?? '') || a.name.localeCompare(b.name))
}
