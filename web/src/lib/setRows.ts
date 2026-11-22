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

/**
 * The layout after "+ Set". A set that was taken off the list comes back first (the lowest number), with its plan (the weight and reps
 * to aim for): a plain extra set has no plan, so adding one after removing a planned set used to lose it. When nothing was removed,
 * one extra set is added at the end.
 */
export function addSetRow(layout: SetLayout, exerciseId: string): Required<SetLayout> {
  const removedSets = layout.removedSets ?? {}
  const removed = removedSets[exerciseId] ?? []
  if (removed.length > 0) {
    const back = Math.min(...removed)
    const rest = removed.filter((n) => n !== back)
    const next = { ...removedSets }
    if (rest.length > 0) next[exerciseId] = rest
    else delete next[exerciseId]
    return { extraSets: layout.extraSets, removedSets: next }
  }
  return { extraSets: { ...layout.extraSets, [exerciseId]: (layout.extraSets[exerciseId] ?? 0) + 1 }, removedSets }
}

/** The set numbers shown for an exercise: the planned ones and the extra ones, without the removed ones. */
export function visibleSetNos(layout: SetLayout, exerciseId: string, plannedSetNos: number[]): number[] {
  const extra = layout.extraSets[exerciseId] ?? 0
  const next = Math.max(0, ...plannedSetNos) + 1
  const removed = new Set(layout.removedSets?.[exerciseId] ?? [])
  return [...plannedSetNos, ...Array.from({ length: extra }, (_, i) => next + i)].filter((n) => !removed.has(n))
}
