import { supabase } from './supabase'

export type RoutineItem = { exerciseId: string; targetSets: number }

const friendly = (e: { code?: string; message: string }) =>
  e.code === '23505' ? 'You already have a routine with that name.' : e.message

/** Creates a routine with its exercises in order. Needs signal: routines live in the database. */
export async function createRoutine(name: string, items: RoutineItem[]): Promise<string> {
  const { data: last, error: posError } = await supabase
    .from('routines')
    .select('position')
    .is('deleted_at', null)
    .order('position', { ascending: false })
    .limit(1)
  if (posError) throw new Error(friendly(posError))

  const id = crypto.randomUUID()
  const { error } = await supabase.from('routines').insert({ id, name: name.trim(), position: (last?.[0]?.position ?? -1) + 1 })
  if (error) throw new Error(friendly(error))

  if (items.length) {
    const { error: itemsError } = await supabase.from('routine_exercises').insert(
      items.map((it, i) => ({
        id: crypto.randomUUID(),
        routine_id: id,
        exercise_id: it.exerciseId,
        position: i + 1,
        target_sets: it.targetSets,
        priority: 1,
      })),
    )
    if (itemsError) throw new Error(friendly(itemsError))
  }
  return id
}

/** First free "Workout X" name (A, B, C ... then D), based on the routine list saved on this phone. */
export function suggestRoutineName(): string {
  let taken = new Set<string>()
  try {
    taken = new Set((JSON.parse(localStorage.getItem('gl_routines') ?? '[]') as { name: string }[]).map((r) => r.name))
  } catch {
    // no saved list: start from A
  }
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!taken.has(`Workout ${letter}`)) return `Workout ${letter}`
  return 'New workout'
}

export type EditableRoutine = { name: string; items: (RoutineItem & { name: string })[] }

export async function loadRoutineForEdit(id: string): Promise<EditableRoutine> {
  const [r, items] = await Promise.all([
    supabase.from('routines').select('name').eq('id', id).single(),
    supabase
      .from('routine_exercises')
      .select('exercise_id, target_sets, position, exercises(name)')
      .eq('routine_id', id)
      .is('deleted_at', null)
      .order('position'),
  ])
  if (r.error) throw new Error(r.error.message)
  if (items.error) throw new Error(items.error.message)
  return {
    name: r.data.name,
    items: (items.data ?? []).map((x) => ({
      exerciseId: x.exercise_id,
      targetSets: x.target_sets,
      name: (x.exercises as unknown as { name: string }).name,
    })),
  }
}

/** Saves a routine's name, exercises, order and set counts. Removed exercises are soft-deleted so history keeps
 * its meaning, and an exercise that is added back simply comes back to life. */
export async function updateRoutine(id: string, name: string, items: RoutineItem[]) {
  const { error: nameError } = await supabase.from('routines').update({ name: name.trim() }).eq('id', id)
  if (nameError) throw new Error(friendly(nameError))

  const { data: existing, error } = await supabase.from('routine_exercises').select('id, exercise_id, deleted_at').eq('routine_id', id)
  if (error) throw new Error(error.message)
  const byExercise = new Map((existing ?? []).map((r) => [r.exercise_id as string, r]))
  const keep = new Set(items.map((i) => i.exerciseId))

  const removed = (existing ?? []).filter((r) => !r.deleted_at && !keep.has(r.exercise_id)).map((r) => r.id as string)
  if (removed.length) {
    const { error: e } = await supabase.from('routine_exercises').update({ deleted_at: new Date().toISOString() }).in('id', removed)
    if (e) throw new Error(e.message)
  }

  for (const [i, it] of items.entries()) {
    const row = byExercise.get(it.exerciseId)
    const result = row
      ? await supabase.from('routine_exercises').update({ position: i + 1, target_sets: it.targetSets, deleted_at: null }).eq('id', row.id)
      : await supabase.from('routine_exercises').insert({
          id: crypto.randomUUID(),
          routine_id: id,
          exercise_id: it.exerciseId,
          position: i + 1,
          target_sets: it.targetSets,
          priority: 1,
        })
    if (result.error) throw new Error(result.error.message)
  }
}

/** Hides a routine. Its past sessions stay in History. */
export async function deleteRoutine(id: string) {
  const { error } = await supabase.from('routines').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Rebuilds the automatic plan for a routine after it changed. Claude's plan is never touched. */
export async function regenerateRulesPlan(routineId: string) {
  await supabase.rpc('generate_plan', { p_routine_id: routineId }) // best effort: the routine is saved either way
}
