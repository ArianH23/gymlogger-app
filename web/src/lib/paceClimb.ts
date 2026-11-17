import type { TrackPoint } from './runs'

// Pace against climb along a run. The route is cut into 100 m pieces; each piece gets its pace (from the track's times) and
// the gradient there (from the altitude). Display only: the run's official numbers (distance, moving time, per-km splits)
// stay the ones the database computes.

const PIECE_M = 100
const MAX_GAP_S = 30 // a longer gap between two points is a pause: the same rule the database uses for moving time
const MAX_PACE = 20 * 60 // seconds per km: slower than this is standing still, not running
const FLAT_GRADE = 2 // percent: between -2 and +2 counts as flat

export type Piece = { km: number; pace: number; alt: number | null; grade: number | null }

/** The run in 100 m pieces: the middle of each piece in km, its pace in s/km, its altitude and the gradient in percent. */
export function pacePieces(track: TrackPoint[]): Piece[] {
  const buckets = new Map<number, TrackPoint[]>()
  for (const p of track) {
    const i = Math.floor(p.d / PIECE_M)
    buckets.set(i, [...(buckets.get(i) ?? []), p])
  }
  const raw: { km: number; pace: number | null; alt: number | null; d: number }[] = []
  for (const [i, pts] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    const dd = last.d - first.d
    let pace: number | null = null
    // pieces with too few points, with a pause inside, or standing still have no pace
    const paused = pts.some((p, k) => k > 0 && p.t - pts[k - 1].t > MAX_GAP_S)
    if (pts.length >= 2 && dd >= PIECE_M * 0.5 && !paused) {
      const v = ((last.t - first.t) / dd) * 1000
      if (v > 0 && v <= MAX_PACE) pace = v
    }
    const alts = pts.filter((p) => p.alt !== null).map((p) => p.alt as number)
    raw.push({ km: (i * PIECE_M + PIECE_M / 2) / 1000, pace, alt: alts.length ? alts.reduce((a, b) => a + b, 0) / alts.length : null, d: i * PIECE_M + PIECE_M / 2 })
  }
  // the gradient over the neighbouring pieces (200 m), which steadies the noise of a single piece's altitude
  return raw
    .map((r, i) => {
      const a = raw[i - 1]?.alt ?? r.alt
      const b = raw[i + 1]?.alt ?? r.alt
      const from = raw[i - 1] ?? r
      const to = raw[i + 1] ?? r
      const span = to.d - from.d
      const grade = a !== null && b !== null && span > 0 ? ((b - a) / span) * 100 : null
      return { km: r.km, pace: r.pace, alt: r.alt, grade }
    })
    .filter((r): r is Piece => r.pace !== null)
}

export type GradeGroup = { label: 'Uphill' | 'Flat' | 'Downhill'; pace: number; meters: number }

/** Average pace on the uphill, flat and downhill parts (more than 2 % either way is a slope). Null without altitude, or when one kind is all there is. */
export function paceByGrade(pieces: Piece[]): GradeGroup[] | null {
  const groups: Record<GradeGroup['label'], { s: number; m: number }> = { Uphill: { s: 0, m: 0 }, Flat: { s: 0, m: 0 }, Downhill: { s: 0, m: 0 } }
  for (const p of pieces) {
    if (p.grade === null) continue
    const g = p.grade > FLAT_GRADE ? 'Uphill' : p.grade < -FLAT_GRADE ? 'Downhill' : 'Flat'
    groups[g].s += (p.pace * PIECE_M) / 1000 // seconds spent on this piece
    groups[g].m += PIECE_M
  }
  const out = (['Uphill', 'Flat', 'Downhill'] as const)
    .filter((k) => groups[k].m >= 200) // under 200 m is too little to say anything about
    .map((k) => ({ label: k, pace: (groups[k].s / groups[k].m) * 1000, meters: groups[k].m }))
  return out.length >= 2 ? out : null
}
