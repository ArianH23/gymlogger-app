import { describe, expect, it } from 'vitest'
import { MAX_REPS, MAX_WEIGHT_KG, parseSetInput } from './setInput'

describe('parseSetInput', () => {
  it('reads a normal set', () => {
    expect(parseSetInput('62.5', '8')).toEqual({ ok: true, weightKg: 62.5, reps: 8 })
  })

  it('takes a comma as the decimal sign', () => {
    expect(parseSetInput('62,5', '8')).toEqual({ ok: true, weightKg: 62.5, reps: 8 })
  })

  it('an empty weight is bodyweight, not an error', () => {
    expect(parseSetInput('', '12')).toEqual({ ok: true, weightKg: null, reps: 12 })
    expect(parseSetInput('  ', '12')).toEqual({ ok: true, weightKg: null, reps: 12 })
  })

  it('accepts zero reps and zero weight', () => {
    expect(parseSetInput('0', '0')).toEqual({ ok: true, weightKg: 0, reps: 0 })
  })

  it('needs the reps', () => {
    expect(parseSetInput('40', '')).toMatchObject({ ok: false })
  })

  it('refuses reps the database would refuse: negative, with decimals, too many, not a number', () => {
    for (const reps of ['-3', '1.5', String(MAX_REPS + 1), 'abc', '8x']) expect(parseSetInput('40', reps), reps).toMatchObject({ ok: false })
  })

  it('refuses a weight the database would refuse: negative, too large, not a number', () => {
    for (const w of ['-5', String(MAX_WEIGHT_KG + 1), '10000', 'heavy', 'Infinity']) expect(parseSetInput(w, '8'), w).toMatchObject({ ok: false })
  })

  it('keeps the weight to two decimals, which is what the database stores', () => {
    expect(parseSetInput('62.499', '8')).toEqual({ ok: true, weightKg: 62.5, reps: 8 })
  })

  it('accepts the largest values it allows', () => {
    expect(parseSetInput(String(MAX_WEIGHT_KG), String(MAX_REPS))).toEqual({ ok: true, weightKg: MAX_WEIGHT_KG, reps: MAX_REPS })
  })
})
