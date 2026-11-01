import { supabase } from './supabase'
import { db, type LastSet, type PlanExercise, type PlanSet } from './db'

type ExerciseInfo = { name: string; load_type: PlanExercise['loadType']; unilateral: boolean; dumbbell_pair: boolean }

type PlannedSetRow = {
  exercise_id: string
  exercise_position: number
  set_no: number
  target_weight_kg: number | null
  target_reps_min: number | null
  target_reps_max: number | null
  note: string | null
  exercises: ExerciseInfo
}

type RoutineExerciseRow = { exercise_id: string; position: number; target_sets: number; exercises: ExerciseInfo }

type LastRow = {
  exercise_id: string
  set_no: number
  weight_kg: number | null
  reps_l: number | null
  reps_r: number | null
  reps_result: number | null
}

const EXERCISE_FIELDS = 'exercises(name, load_type, unilateral, dumbbell_pair)'

/** Everything the workout screen needs for one routine: the exercises in order, the plan's targets
 * (Claude's plan if there is one, else the automatic one) and what you did last time. */
async function fetchWorkoutPlanFromServer(routineId: string): Promise<PlanExercise[]> {
  const exercises = new Map<string, PlanExercise>()
  const order: string[] = []
  const add = (id: string, info: ExerciseInfo) => {
    if (!exercises.has(id)) {
      exercises.set(id, {
        exerciseId: id,
        name: info.name,
        loadType: info.load_type,
        unilateral: info.unilateral,
        dumbbellPair: info.dumbbell_pair,
        sets: [],
        last: [],
      })
      order.push(id)
    }
    return exercises.get(id)!
  }

  const { data: plan, error: planError } = await supabase
    .from('current_plan')
    .select('id')
    .eq('routine_id', routineId)
    .maybeSingle()
  if (planError) throw planError

  if (plan) {
    const { data, error } = await supabase
      .from('planned_sets')
      .select(`exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min, target_reps_max, note, ${EXERCISE_FIELDS}`)
      .eq('planned_session_id', plan.id)
      .order('exercise_position')
      .order('set_no')
    if (error) throw error
    for (const r of (data ?? []) as unknown as PlannedSetRow[]) {
      const set: PlanSet = {
        setNo: r.set_no,
        weightKg: r.target_weight_kg,
        repsMin: r.target_reps_min,
        repsMax: r.target_reps_max,
        note: r.note,
      }
      add(r.exercise_id, r.exercises).sets.push(set)
    }
  } else {
    // No plan yet: the routine's own exercises, with their usual number of sets and no targets.
    const { data, error } = await supabase
      .from('routine_exercises')
      .select(`exercise_id, position, target_sets, ${EXERCISE_FIELDS}`)
      .eq('routine_id', routineId)
      .is('deleted_at', null)
      .order('position')
    if (error) throw error
    for (const r of (data ?? []) as unknown as RoutineExerciseRow[]) {
      const ex = add(r.exercise_id, r.exercises)
      for (let i = 1; i <= r.target_sets; i++) ex.sets.push({ setNo: i, weightKg: null, repsMin: null, repsMax: null, note: null })
    }
  }

  if (order.length) {
    const { data, error } = await supabase
      .from('last_performance')
      .select('exercise_id, set_no, weight_kg, reps_l, reps_r, reps_result')
      .in('exercise_id', order)
      .order('set_no')
    if (error) throw error
    for (const r of (data ?? []) as unknown as LastRow[]) {
      const last: LastSet = {
        setNo: r.set_no,
        weightKg: r.weight_kg,
        repsL: r.reps_l,
        repsR: r.reps_r,
        repsResult: r.reps_result,
      }
      exercises.get(r.exercise_id)?.last.push(last)
    }
  }

  return order.map((id) => exercises.get(id)!)
}

/** The plan for a routine: fresh from Supabase when there is signal (and kept on the phone), otherwise the
 * last copy that was downloaded. Fails only if there is no signal and nothing was ever downloaded. */
export async function getWorkoutPlan(routineId: string): Promise<PlanExercise[]> {
  try {
    const plan = await fetchWorkoutPlanFromServer(routineId)
    await db.plans.put({ routineId, plan, fetchedAt: new Date().toISOString() })
    return plan
  } catch (e) {
    const cached = await db.plans.get(routineId)
    if (cached) return cached.plan
    throw e
  }
}

/** Downloads every routine's plan in the background, so they are on the phone before the signal drops. */
export async function prefetchPlans(routineIds: string[]) {
  await Promise.allSettled(routineIds.map((id) => getWorkoutPlan(id)))
}
