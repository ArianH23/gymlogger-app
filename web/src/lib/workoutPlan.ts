import { supabase } from './supabase'
import { db, type LastSet, type PlanExercise, type PlanSet } from './db'

type ExerciseInfo = { name: string; load_type: PlanExercise['loadType']; unilateral: boolean; dumbbell_pair: boolean }

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

  // workout_plan() is the winning plan (Claude's if there is one), kept in step with later edits to the routine.
  const { data: planRows, error: planError } = await supabase.rpc('workout_plan', { p_routine_id: routineId })
  if (planError) throw planError

  if (planRows && planRows.length > 0) {
    const rows = planRows as unknown as {
      exercise_id: string
      set_no: number
      target_weight_kg: number | null
      target_reps_min: number | null
      target_reps_max: number | null
      note: string | null
    }[]
    const ids = [...new Set(rows.map((r) => r.exercise_id))]
    const { data: infos, error } = await supabase.from('exercises').select('id, name, load_type, unilateral, dumbbell_pair').in('id', ids)
    if (error) throw error
    const infoById = new Map((infos ?? []).map((e) => [e.id as string, e as unknown as ExerciseInfo]))
    for (const r of rows) {
      const set: PlanSet = {
        setNo: r.set_no,
        weightKg: r.target_weight_kg,
        repsMin: r.target_reps_min,
        repsMax: r.target_reps_max,
        note: r.note,
      }
      add(r.exercise_id, infoById.get(r.exercise_id)!).sets.push(set)
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

/** Only one workout can be open at a time, so nothing here starts a second one. */
async function assertNoOpenWorkout() {
  const open = await db.workouts.filter((w) => !w.endedAt).first()
  if (open) throw new Error(`${open.title} is still in progress. Finish or discard it first.`)
}

/** Creates an empty workout (exercises are added as you go) and returns its id. */
export async function startEmptyWorkout(): Promise<string> {
  await assertNoOpenWorkout()
  const hour = new Date().getHours()
  const id = crypto.randomUUID()
  await db.workouts.add({
    id,
    routineId: null,
    title: hour < 12 ? 'Morning workout' : hour < 18 ? 'Afternoon workout' : 'Evening workout',
    startedAt: new Date().toISOString(),
    endedAt: null,
    plan: [],
    extraSets: {},
  })
  return id
}

/** Creates the on-phone workout for a routine (with its plan) and returns its id. */
export async function startRoutineWorkout(routineId: string, title: string): Promise<string> {
  await assertNoOpenWorkout()
  const plan = await getWorkoutPlan(routineId)
  const id = crypto.randomUUID()
  await db.workouts.add({ id, routineId, title, startedAt: new Date().toISOString(), endedAt: null, plan, extraSets: {} })
  return id
}
