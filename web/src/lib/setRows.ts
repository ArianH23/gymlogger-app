// Taking an empty set off the list of an exercise in the open workout. The same rule as the watch (AppViewModel.removeRow), so a
// workout shared between the two behaves the same on both.

export type SetLayout = {
  extraSets: Record<string, number> // exerciseId -> sets added with "+ Set"
  removedSets?: Record<string, number[]> // exerciseId -> set numbers taken off the list
}

/**
 * The layout after taking set number `setNo` off the exercise. When it is the last of the extra sets, the extra count goes down;
 * otherwise (a planned set, or an extra one with another after it) the number is added to the removed list.
 * `plannedSetNos` are the set numbers of the plan for this exercise.
 */
export function removeSetRow(layout: SetLayout, exerciseId: string, plannedSetNos: number[], setNo: number): Required<SetLayout> {
  const removedSets = layout.removedSets ?? {}
  const extra = layout.extraSets[exerciseId] ?? 0
  const lastExtra = Math.max(0, ...plannedSetNos) + extra
  if (extra > 0 && setNo === lastExtra) {
    return { extraSets: { ...layout.extraSets, [exerciseId]: extra - 1 }, removedSets }
  }
  const already = removedSets[exerciseId] ?? []
  if (already.includes(setNo)) return { extraSets: layout.extraSets, removedSets }
  return { extraSets: layout.extraSets, removedSets: { ...removedSets, [exerciseId]: [...already, setNo] } }
}

/** The set numbers shown for an exercise: the planned ones and the extra ones, without the removed ones. */
export function visibleSetNos(layout: SetLayout, exerciseId: string, plannedSetNos: number[]): number[] {
  const extra = layout.extraSets[exerciseId] ?? 0
  const next = Math.max(0, ...plannedSetNos) + 1
  const removed = new Set(layout.removedSets?.[exerciseId] ?? [])
  return [...plannedSetNos, ...Array.from({ length: extra }, (_, i) => next + i)].filter((n) => !removed.has(n))
}
