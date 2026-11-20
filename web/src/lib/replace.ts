import type { PlanExercise, Workout } from './db'

// Replacing one exercise by another where it stands: the same place in the workout or routine, the same number of sets.

type Layout = Pick<Workout, 'plan' | 'extraSets' | 'removedSets'>

/** The workout's added and removed sets without those of one exercise (it left the workout, or was swapped for another). */
export function withoutExerciseLayout(w: Pick<Workout, 'extraSets' | 'removedSets'>, exerciseId: string): Pick<Workout, 'extraSets' | 'removedSets'> {
  const { [exerciseId]: _extra, ...extraSets } = w.extraSets
  const removedSets = { ...(w.removedSets ?? {}) }
  delete removedSets[exerciseId]
  return { extraSets, removedSets }
}

/**
 * The workout's plan with one exercise replaced by another in the same position. The old exercise's added and removed sets go with
 * it (the new one starts with the number of sets it is given). Unchanged if the new exercise is already in the workout.
 */
export function replaceInWorkout(w: Layout, oldId: string, next: PlanExercise): Layout {
  if (next.exerciseId !== oldId && w.plan.some((e) => e.exerciseId === next.exerciseId)) return w
  return { plan: w.plan.map((e) => (e.exerciseId === oldId ? next : e)), ...withoutExerciseLayout(w, oldId) }
}

type Item = { exerciseId: string; name: string; targetSets: number; backupId?: string | null; backupName?: string | null }

/**
 * The routine's exercises with one replaced by another in the same position and with the same number of sets. A backup is kept, unless it
 * is the exercise that has just taken the place (an exercise cannot be its own backup). Unchanged if the new exercise is already there.
 */
export function replaceRoutineItem<T extends Item>(items: T[], oldId: string, next: { exerciseId: string; name: string }): T[] {
  if (next.exerciseId !== oldId && items.some((x) => x.exerciseId === next.exerciseId)) return items
  return items.map((x) =>
    x.exerciseId !== oldId
      ? x
      : { ...x, exerciseId: next.exerciseId, name: next.name, ...(x.backupId === next.exerciseId ? { backupId: null, backupName: null } : {}) },
  )
}
