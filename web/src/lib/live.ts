import type { LoggedSet, PlanExercise, Workout } from './db'

// The open workout travels between devices as JSON: the plan layout ("live") and the sets. The plan uses the same shape as
// the database function workout_start returns, so the watch can read it as it is.

export type LiveExercise = {
  exercise_id: string
  name: string
  load_type: PlanExercise['loadType']
  unilateral: boolean
  dumbbell_pair: boolean
  increment_kg: number | null
  sets: { set_no: number; target_weight_kg: number | null; target_reps_min: number | null; target_reps_max: number | null; note: string | null }[]
  last: { set_no: number; weight_kg: number | null; reps_l: number | null; reps_r: number | null; reps_result: number | null }[]
  backup?: LiveExercise | null
  swapped?: boolean
}

export type Live = {
  plan: LiveExercise[]
  extra_sets: Record<string, number>
  removed_sets: Record<string, number[]>
}

export type ServerSet = {
  id: string
  exercise_id: string
  set_no: number
  side: 'L' | 'R' | null
  weight_kg: number | null
  reps: number
  is_warmup: boolean
  logged_at: string
}

export type ServerWorkout = {
  id: string
  routine_id: string | null
  title: string
  started_at: string
  ended_at: string | null
  feeling: number | null
  live: Live | null
  live_updated_at: string | null
  sets: ServerSet[]
}

const exerciseToLive = (e: PlanExercise): LiveExercise => ({
  exercise_id: e.exerciseId,
  name: e.name,
  load_type: e.loadType,
  unilateral: e.unilateral,
  dumbbell_pair: e.dumbbellPair,
  increment_kg: e.incrementKg ?? null,
  sets: e.sets.map((s) => ({ set_no: s.setNo, target_weight_kg: s.weightKg, target_reps_min: s.repsMin, target_reps_max: s.repsMax, note: s.note })),
  last: e.last.map((l) => ({ set_no: l.setNo, weight_kg: l.weightKg, reps_l: l.repsL, reps_r: l.repsR, reps_result: l.repsResult })),
  backup: e.backup ? exerciseToLive(e.backup) : null,
  swapped: e.swapped ?? false,
})

/** One exercise in the shape the database (workout_start, routine_backups) and the watch use, as the phone keeps it. */
export const exerciseFromLive = (e: LiveExercise): PlanExercise => ({
  exerciseId: e.exercise_id,
  name: e.name,
  loadType: e.load_type,
  unilateral: e.unilateral,
  dumbbellPair: e.dumbbell_pair,
  incrementKg: e.increment_kg === null || e.increment_kg === undefined ? null : Number(e.increment_kg),
  sets: (e.sets ?? []).map((s) => ({ setNo: s.set_no, weightKg: s.target_weight_kg, repsMin: s.target_reps_min, repsMax: s.target_reps_max, note: s.note })),
  last: (e.last ?? []).map((l) => ({ setNo: l.set_no, weightKg: l.weight_kg, repsL: l.reps_l, repsR: l.reps_r, repsResult: l.reps_result })),
  backup: e.backup ? exerciseFromLive(e.backup) : null,
  swapped: e.swapped ?? false,
})

export function toLive(w: Workout): Live {
  return { plan: w.plan.map(exerciseToLive), extra_sets: w.extraSets, removed_sets: w.removedSets ?? {} }
}

export function fromLive(live: Live): Pick<Workout, 'plan' | 'extraSets' | 'removedSets'> {
  return { plan: (live.plan ?? []).map(exerciseFromLive), extraSets: live.extra_sets ?? {}, removedSets: live.removed_sets ?? {} }
}

export const setToServer = (s: LoggedSet): ServerSet => ({
  id: s.id,
  exercise_id: s.exerciseId,
  set_no: s.setNo,
  side: s.side,
  weight_kg: s.weightKg,
  reps: s.reps,
  is_warmup: s.isWarmup,
  logged_at: s.loggedAt,
})

export const setFromServer = (s: ServerSet, sessionId: string): LoggedSet => ({
  id: s.id,
  sessionId,
  exerciseId: s.exercise_id,
  setNo: s.set_no,
  side: s.side,
  weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
  reps: s.reps,
  isWarmup: s.is_warmup,
  loggedAt: s.logged_at,
  synced: 1,
})

/** Two sets are the same set when exercise, set number and side match, whatever their ids say. */
export const setKey = (s: { exerciseId: string; setNo: number; side: string | null }) => `${s.exerciseId}|${s.setNo}|${s.side ?? ''}`
