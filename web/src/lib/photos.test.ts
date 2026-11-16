import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { fitWithin } from './photos'

describe('fitWithin', () => {
  it('scales a tall photo so its longer side is the maximum', () => {
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('scales a wide photo by its width', () => {
    expect(fitWithin(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 })
  })

  it('never makes a small image bigger', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('keeps an image that is exactly the maximum', () => {
    expect(fitWithin(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 })
  })
})
