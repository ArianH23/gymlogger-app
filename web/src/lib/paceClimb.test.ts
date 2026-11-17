import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { pacePieces, paceByGrade } from './paceClimb'
import type { TrackPoint } from './runs'

// A point every 20 m. paceAt(d) = seconds per km at that distance; altAt(d) = altitude there.
function route(totalM: number, paceAt: (d: number) => number, altAt: (d: number) => number | null): TrackPoint[] {
  const pts: TrackPoint[] = []
  let t = 0
  for (let d = 0; d <= totalM; d += 20) {
    if (d > 0) t += (paceAt(d) * 20) / 1000
    pts.push({ t, lat: 41, lon: 2, alt: altAt(d), d, hr: null })
  }
  return pts
}

describe('pacePieces', () => {
  it('gives each 100 m its pace and its gradient', () => {
    // flat 1 km at 6:00, then a 5 % climb at 7:30
    const pieces = pacePieces(route(2000, (d) => (d < 1000 ? 360 : 450), (d) => (d < 1000 ? 50 : 50 + (d - 1000) * 0.05)))
    const flat = pieces.find((p) => p.km > 0.4 && p.km < 0.6)!
    const climb = pieces.find((p) => p.km > 1.4 && p.km < 1.6)!
    expect(flat.pace).toBeCloseTo(360, 0)
    expect(Math.abs(flat.grade!)).toBeLessThan(0.5)
    expect(climb.pace).toBeCloseTo(450, 0)
    expect(climb.grade).toBeCloseTo(5, 0)
  })

  it('leaves out a piece with a pause inside it', () => {
    const pts = route(1000, () => 360, () => 10)
    const stopped = pts.map((p) => (p.d >= 500 ? { ...p, t: p.t + 120 } : p)) // two minutes standing still at 500 m
    const pieces = pacePieces(stopped)
    expect(pieces.some((p) => p.km > 0.45 && p.km < 0.55)).toBe(false)
    expect(pieces.length).toBeGreaterThanOrEqual(8)
  })

  it('has no gradient without altitude, but still has the pace', () => {
    const pieces = pacePieces(route(1000, () => 360, () => null))
    expect(pieces.length).toBeGreaterThan(5)
    expect(pieces.every((p) => p.grade === null && p.alt === null)).toBe(true)
  })

  it('is empty for a run with no distance', () => {
    expect(pacePieces([])).toEqual([])
  })
})

describe('paceByGrade', () => {
  it('shows you slower uphill than on the flat', () => {
    // 1 km flat at 6:00, 1 km climbing 5 % at 7:30, 1 km flat again
    const alt = (d: number) => (d < 1000 ? 0 : d < 2000 ? (d - 1000) * 0.05 : 50)
    const groups = paceByGrade(pacePieces(route(3000, (d) => (d >= 1000 && d < 2000 ? 450 : 360), alt)))!
    const up = groups.find((g) => g.label === 'Uphill')!
    const flat = groups.find((g) => g.label === 'Flat')!
    expect(up.pace).toBeGreaterThan(flat.pace + 60)
    expect(groups.find((g) => g.label === 'Downhill')).toBeUndefined() // no downhill, so no row for it
  })

  it('is null when every part is the same kind of ground', () => {
    expect(paceByGrade(pacePieces(route(2000, () => 360, () => 10)))).toBeNull()
  })

  it('is null without altitude', () => {
    expect(paceByGrade(pacePieces(route(2000, () => 360, () => null)))).toBeNull()
  })
})
