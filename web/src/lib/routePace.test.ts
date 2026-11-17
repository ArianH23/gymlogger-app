import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { paceRange, paceSegments, rampColor } from './routePace'
import type { RunSplit, TrackPoint } from './runs'

const split = (km: number, seconds: number, distanceM = 1000): RunSplit => ({ km, distanceM, seconds, elevChangeM: null, avgHr: null })
// a straight line north, a point every 250 m
const track = (meters: number): TrackPoint[] =>
  Array.from({ length: meters / 250 + 1 }, (_, i) => ({ t: i * 90, lat: 41 + (i * 250) / 111000, lon: 2, alt: null, d: i * 250, hr: null }))

describe('rampColor', () => {
  it('gives slow, middle and fast three different colours', () => {
    expect(new Set([rampColor(0), rampColor(0.5), rampColor(1)]).size).toBe(3)
  })
  it('stays inside the ramp', () => {
    expect(rampColor(-3)).toBe(rampColor(0))
    expect(rampColor(7)).toBe(rampColor(1))
  })
})

describe('paceSegments', () => {
  it('cuts the route at each kilometre, colouring the slowest orange and the fastest jade', () => {
    const segs = paceSegments(track(3000), [split(1, 360), split(2, 420), split(3, 330)])
    expect(segs.map((s) => s.km)).toEqual([1, 2, 3])
    expect(segs[1].color).toBe(rampColor(0)) // 7:00 is the slowest
    expect(segs[2].color).toBe(rampColor(1)) // 5:30 is the fastest
  })

  it('joins the kilometres so the line has no gaps', () => {
    const segs = paceSegments(track(2000), [split(1, 360), split(2, 400)])
    expect(segs[1].points[0]).toEqual(segs[0].points[segs[0].points.length - 1])
  })

  it('gives every kilometre the middle colour when the pace is even', () => {
    const segs = paceSegments(track(2000), [split(1, 360), split(2, 360)])
    expect(new Set(segs.map((s) => s.color))).toEqual(new Set([rampColor(0.5)]))
  })

  it('keeps a last bit that is not a full kilometre, without letting it set the range', () => {
    const segs = paceSegments(track(1500), [split(1, 360), split(2, 100, 500)]) // 500 m in 100 s = 3:20 per km
    expect(segs.length).toBe(2)
    expect(segs[1].full).toBe(false)
    expect(paceRange([split(1, 360), split(2, 100, 500)])).toBeNull() // one full kilometre: no range to show
  })

  it('draws nothing without a route or splits', () => {
    expect(paceSegments([], [split(1, 360)])).toEqual([])
    expect(paceSegments(track(1000), [])).toEqual([])
  })
})

describe('paceRange', () => {
  it('is the slowest and fastest full kilometre', () => {
    expect(paceRange([split(1, 360), split(2, 420), split(3, 330)])).toEqual({ slowest: 420, fastest: 330 })
  })
})
