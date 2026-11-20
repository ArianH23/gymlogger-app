import { describe, expect, it } from 'vitest'
import { shouldClearFor } from './localData'

describe('shouldClearFor', () => {
  it('clears when another account used the phone before', () => {
    expect(shouldClearFor('a', 'b')).toBe(true)
  })

  it('keeps everything when it is the same account signing in again', () => {
    expect(shouldClearFor('a', 'a')).toBe(false)
  })

  it('keeps everything on a phone that has not noted an account yet (the first run after this was added)', () => {
    expect(shouldClearFor(null, 'a')).toBe(false)
  })
})
