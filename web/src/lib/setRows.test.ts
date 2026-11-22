import { describe, expect, it } from 'vitest'
import { addSetRow, removeSetRow, visibleSetNos } from './setRows'

const planned = [1, 2, 3]

describe('removeSetRow', () => {
  it('lowers the extra count when the last extra set is removed', () => {
    const after = removeSetRow({ extraSets: { bench: 2 } }, 'bench', planned, 5)
    expect(after.extraSets.bench).toBe(1)
    expect(after.removedSets.bench).toBeUndefined()
    expect(visibleSetNos(after, 'bench', planned)).toEqual([1, 2, 3, 4])
  })

  it('puts a planned set on the removed list', () => {
    const after = removeSetRow({ extraSets: {} }, 'bench', planned, 2)
    expect(visibleSetNos(after, 'bench', planned)).toEqual([1, 3])
  })

  it('puts an extra set that is not the last on the removed list, and keeps the rest', () => {
    const after = removeSetRow({ extraSets: { bench: 2 } }, 'bench', planned, 4)
    expect(after.extraSets.bench).toBe(2)
    expect(visibleSetNos(after, 'bench', planned)).toEqual([1, 2, 3, 5])
  })

  it('does not list the same set twice, and leaves other exercises alone', () => {
    const once = removeSetRow({ extraSets: {}, removedSets: { squat: [1] } }, 'bench', planned, 3)
    const twice = removeSetRow(once, 'bench', planned, 3)
    expect(twice.removedSets.bench).toEqual([3])
    expect(twice.removedSets.squat).toEqual([1])
  })

  it('does not change the layout it was given', () => {
    const layout = { extraSets: { bench: 1 }, removedSets: { bench: [1] } }
    removeSetRow(layout, 'bench', planned, 4)
    removeSetRow(layout, 'bench', planned, 2)
    expect(layout).toEqual({ extraSets: { bench: 1 }, removedSets: { bench: [1] } })
  })
})

describe('visibleSetNos', () => {
  it('shows the planned sets and then the extra ones', () => {
    expect(visibleSetNos({ extraSets: { bench: 2 } }, 'bench', planned)).toEqual([1, 2, 3, 4, 5])
  })

  it('an extra set added again after removing the last one comes back with the next number', () => {
    const removed = removeSetRow({ extraSets: { bench: 1 } }, 'bench', planned, 4)
    expect(visibleSetNos({ ...removed, extraSets: { bench: removed.extraSets.bench + 1 } }, 'bench', planned)).toEqual([1, 2, 3, 4])
  })
})

describe('addSetRow', () => {
  it('adds an extra set at the end when nothing was removed', () => {
    const after = addSetRow({ extraSets: { bench: 1 } }, 'bench')
    expect(after.extraSets.bench).toBe(2)
    expect(visibleSetNos(after, 'bench', planned)).toEqual([1, 2, 3, 4, 5])
  })

  it('brings a removed planned set back, with its plan, instead of adding a plain extra one', () => {
    const removed = removeSetRow({ extraSets: {} }, 'bench', planned, 2)
    expect(visibleSetNos(removed, 'bench', planned)).toEqual([1, 3])
    const back = addSetRow(removed, 'bench')
    expect(visibleSetNos(back, 'bench', planned)).toEqual([1, 2, 3]) // set 2 is back where it was, and is still a planned set
    expect(back.extraSets.bench).toBeUndefined()
    expect(back.removedSets.bench).toBeUndefined()
  })

  it('brings back the lowest removed number first', () => {
    let l = removeSetRow({ extraSets: {} }, 'bench', planned, 3)
    l = removeSetRow(l, 'bench', planned, 1)
    expect(visibleSetNos(l, 'bench', planned)).toEqual([2])
    l = addSetRow(l, 'bench')
    expect(visibleSetNos(l, 'bench', planned)).toEqual([1, 2])
    l = addSetRow(l, 'bench')
    expect(visibleSetNos(l, 'bench', planned)).toEqual([1, 2, 3])
  })

  it('goes back to adding extra sets once every removed set is back', () => {
    let l = removeSetRow({ extraSets: {} }, 'bench', planned, 2)
    l = addSetRow(l, 'bench')
    l = addSetRow(l, 'bench')
    expect(visibleSetNos(l, 'bench', planned)).toEqual([1, 2, 3, 4])
  })

  it('does not touch another exercise\'s removed sets, or change what it was given', () => {
    const l = { extraSets: {}, removedSets: { squat: [1], bench: [2] } }
    const after = addSetRow(l, 'bench')
    expect(after.removedSets).toEqual({ squat: [1] })
    expect(l.removedSets).toEqual({ squat: [1], bench: [2] })
  })
})
