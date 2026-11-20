import { describe, expect, it } from 'vitest'
import type { PlanExercise } from './db'
import { replaceInWorkout, replaceRoutineItem, withoutExerciseLayout } from './replace'

const ex = (id: string, name = id): PlanExercise => ({ exerciseId: id, name, loadType: 'weighted', unilateral: false, dumbbellPair: false, sets: [], last: [] })

describe('withoutExerciseLayout', () => {
  const w = { extraSets: { a: 1, b: 2 }, removedSets: { a: [2], b: [1, 3] } }

  it('forgets the added and removed sets of that exercise only', () => {
    const r = withoutExerciseLayout(w, 'b')
    expect(r.extraSets).toEqual({ a: 1 })
    expect(r.removedSets).toEqual({ a: [2] })
  })

  it('works when nothing was ever removed', () => {
    expect(withoutExerciseLayout({ extraSets: { a: 1 } }, 'a')).toEqual({ extraSets: {}, removedSets: {} })
  })

  it('does not change what it was given', () => {
    withoutExerciseLayout(w, 'a')
    expect(w.removedSets).toEqual({ a: [2], b: [1, 3] })
  })
})

describe('replaceInWorkout', () => {
  const w = { plan: [ex('a'), ex('b'), ex('c')], extraSets: { b: 2, c: 1 }, removedSets: { b: [2], c: [1] } }

  it('puts the new exercise where the old one was', () => {
    expect(replaceInWorkout(w, 'b', ex('x')).plan.map((e) => e.exerciseId)).toEqual(['a', 'x', 'c'])
  })

  it('takes the old exercise\'s added and removed sets with it, and leaves the others', () => {
    const r = replaceInWorkout(w, 'b', ex('x'))
    expect(r.extraSets).toEqual({ c: 1 })
    expect(r.removedSets).toEqual({ c: [1] })
  })

  it('does nothing when the new exercise is already in the workout', () => {
    expect(replaceInWorkout(w, 'b', ex('c'))).toBe(w)
  })

  it('does not change what it was given', () => {
    replaceInWorkout(w, 'b', ex('x'))
    expect(w.plan.map((e) => e.exerciseId)).toEqual(['a', 'b', 'c'])
    expect(w.extraSets).toEqual({ b: 2, c: 1 })
  })

  it('works when nothing was removed on another device', () => {
    expect(replaceInWorkout({ plan: [ex('a')], extraSets: {} }, 'a', ex('x')).plan[0].exerciseId).toBe('x')
  })
})

describe('replaceRoutineItem', () => {
  const items = [
    { exerciseId: 'a', name: 'A', targetSets: 3, backupId: 'z', backupName: 'Z' },
    { exerciseId: 'b', name: 'B', targetSets: 4, backupId: null, backupName: null },
  ]

  it('keeps the position and the number of sets', () => {
    const r = replaceRoutineItem(items, 'b', { exerciseId: 'x', name: 'X' })
    expect(r.map((i) => i.exerciseId)).toEqual(['a', 'x'])
    expect(r[1]).toMatchObject({ name: 'X', targetSets: 4 })
  })

  it('keeps the backup', () => {
    expect(replaceRoutineItem(items, 'a', { exerciseId: 'x', name: 'X' })[0]).toMatchObject({ exerciseId: 'x', backupId: 'z', backupName: 'Z' })
  })

  it('drops the backup when it is the exercise that took the place', () => {
    expect(replaceRoutineItem(items, 'a', { exerciseId: 'z', name: 'Z' })[0]).toMatchObject({ exerciseId: 'z', backupId: null, backupName: null })
  })

  it('does nothing when the new exercise is already in the routine', () => {
    expect(replaceRoutineItem(items, 'a', { exerciseId: 'b', name: 'B' })).toBe(items)
  })
})
