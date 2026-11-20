import { describe, expect, it } from 'vitest'
import { describeRejection, isRejection } from './syncErrors'

describe('isRejection', () => {
  it('is true when the database refused the data', () => {
    expect(isRejection({ code: '23514', message: 'new row violates check constraint "sets_reps_check"' })).toBe(true) // a broken rule
    expect(isRejection({ code: '22003', message: 'numeric field overflow' })).toBe(true) // a value that does not fit
    expect(isRejection({ code: '22P02', message: 'invalid input syntax for type integer' })).toBe(true)
    expect(isRejection({ code: 'P0001', message: 'the workout needs an id' })).toBe(true) // the function's own refusal
  })

  it('is false for no signal, a signed-out session or a slow server, which pass by themselves', () => {
    expect(isRejection(new TypeError('Failed to fetch'))).toBe(false)
    expect(isRejection({ message: 'TypeError: NetworkError when attempting to fetch resource.' })).toBe(false)
    expect(isRejection({ code: 'PGRST301', message: 'JWT expired' })).toBe(false)
    expect(isRejection({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false)
    expect(isRejection({ code: '23505', message: 'duplicate key value violates unique constraint "sets_position_uq"' })).toBe(false) // two calls met: trying again works
    expect(isRejection(null)).toBe(false)
    expect(isRejection(undefined)).toBe(false)
  })
})

describe('describeRejection', () => {
  it('names the problem in words for the known rules', () => {
    const reps = describeRejection({ code: '23514', message: 'new row for relation "sets" violates check constraint "sets_reps_check"' })
    expect(reps).toContain('reps below 0')
    expect(reps).not.toContain('sets_reps_check')
    expect(describeRejection({ code: '23514', message: 'violates check constraint "sets_weight_kg_check"' })).toContain('weight below 0')
  })

  it('explains a number that does not fit or is not a number', () => {
    expect(describeRejection({ code: '22003', message: 'numeric field overflow' })).toContain('too large')
    expect(describeRejection({ code: '22P02', message: 'invalid input syntax for type integer: "x"' })).toContain('not a valid number')
  })

  it('falls back to the database text for anything else', () => {
    expect(describeRejection({ code: 'P0001', message: 'the workout needs an id' })).toBe('the workout needs an id')
  })
})
