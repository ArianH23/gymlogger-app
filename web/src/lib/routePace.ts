import type { RunSplit, TrackPoint } from './runs'

// Colouring a route by kilometre: each kilometre's stretch of the track gets a colour from its pace.

export type LatLon = [number, number]
export type PaceSegment = { km: number; pace: number; full: boolean; color: string; points: LatLon[] }

// slow -> middle -> fast
const RAMP = ['#d95926', '#c8a45c', '#45c08a'] as const

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** The colour for a position along the ramp: 0 = slowest (orange), 1 = fastest (jade). */
export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const a = hex(RAMP[i])
  const b = hex(RAMP[i + 1])
  return toHex(a.map((v, k) => v + (b[k] - v) * (x - i)))
}

/**
 * The route cut at every kilometre, one segment per kilometre with a colour from its pace. The slowest full kilometre is
 * orange and the fastest jade. When every kilometre has the same pace (an even pace was assumed because the GPS did not
 * work) there is nothing to tell apart, so every segment gets the middle colour. A last bit under 100 m gets no pace
 * and is not part of the range; it takes the colour of the kilometre before it.
 */
export function paceSegments(track: TrackPoint[], splits: RunSplit[]): PaceSegment[] {
  const pts = track.filter((p): p is TrackPoint & { lat: number; lon: number } => p.lat !== null && p.lon !== null)
  if (pts.length < 2 || splits.length === 0) return []
  const info = splits
    .filter((s) => s.distanceM >= 100 && s.seconds > 0)
    .map((s) => ({ km: s.km, pace: s.seconds / (s.distanceM / 1000), full: s.distanceM >= 999.5 }))
  if (info.length === 0) return []
  const fullPaces = info.filter((s) => s.full).map((s) => s.pace)
  const lo = Math.min(...(fullPaces.length ? fullPaces : info.map((s) => s.pace)))
  const hi = Math.max(...(fullPaces.length ? fullPaces : info.map((s) => s.pace)))
  const spread = hi - lo >= 1 ? hi - lo : 0
  const colorOf = (pace: number) => (spread === 0 ? rampColor(0.5) : rampColor((hi - pace) / spread))

  const out: PaceSegment[] = []
  for (const s of info) {
    const from = (s.km - 1) * 1000
    const to = s.km * 1000
    const inside = pts.filter((p) => p.d >= from && (!s.full || p.d <= to))
    // join to the kilometre before, so the line has no gaps
    const before = out.length ? out[out.length - 1].points[out[out.length - 1].points.length - 1] : undefined
    const points: LatLon[] = [...(before && inside.length ? [before] : []), ...inside.map((p) => [p.lat, p.lon] as LatLon)]
    if (points.length >= 2) out.push({ km: s.km, pace: s.pace, full: s.full, color: colorOf(s.pace), points })
  }
  return out
}

/** The slowest and the fastest full kilometre, for the legend; null when they are the same pace or there is only one. */
export function paceRange(splits: RunSplit[]): { slowest: number; fastest: number } | null {
  const paces = splits.filter((s) => s.distanceM >= 999.5 && s.seconds > 0).map((s) => s.seconds / (s.distanceM / 1000))
  if (paces.length < 2) return null
  const slowest = Math.max(...paces)
  const fastest = Math.min(...paces)
  return slowest - fastest >= 1 ? { slowest, fastest } : null
}
