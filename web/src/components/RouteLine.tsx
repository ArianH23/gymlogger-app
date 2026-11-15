import type { TrackPoint } from '../lib/runs'

const W = 320
const PAD = 16

/** The shape of the run as a line, start in jade and finish in gold. No map behind it: it works offline and asks nobody. */
export default function RouteLine({ track }: { track: TrackPoint[] }) {
  const pts = track.filter((p): p is TrackPoint & { lat: number; lon: number } => p.lat !== null && p.lon !== null)
  if (pts.length < 2) return <p className="muted note">No GPS route for this run.</p>

  // A flat projection is fine at this size: shrink longitude by the cosine of the latitude so the shape is not stretched.
  const k = Math.cos((pts[0].lat * Math.PI) / 180)
  const xs = pts.map((p) => p.lon * k)
  const ys = pts.map((p) => p.lat)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const spanX = Math.max(...xs) - minX || 1e-9
  const spanY = Math.max(...ys) - minY || 1e-9
  // the height follows the shape of the route, within sensible limits
  const H = Math.round(Math.min(300, Math.max(120, ((W - 2 * PAD) * spanY) / spanX + 2 * PAD)))
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY)
  const ox = (W - spanX * scale) / 2
  const oy = (H - spanY * scale) / 2
  const at = (i: number) => [ox + (xs[i] - minX) * scale, H - oy - (ys[i] - minY) * scale] as const
  const d = pts.map((_, i) => `${i === 0 ? 'M' : 'L'}${at(i)[0].toFixed(1)},${at(i)[1].toFixed(1)}`).join(' ')
  const [sx, sy] = at(0)
  const [ex, ey] = at(pts.length - 1)

  return (
    <>
      <svg className="route" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The route of the run, drawn as a line from start to finish">
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={ex} cy={ey} r="6" fill="var(--gold)" stroke="var(--surface)" strokeWidth="2" />
        <circle cx={sx} cy={sy} r="6" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      </svg>
      <div className="shape-legend">
        <span>
          <i className="swatch dot start" /> Start
        </span>
        <span>
          <i className="swatch dot end" /> Finish
        </span>
      </div>
    </>
  )
}
