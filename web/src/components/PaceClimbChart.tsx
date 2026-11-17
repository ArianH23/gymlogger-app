import { useState, type PointerEvent } from 'react'
import { formatPace, type TrackPoint } from '../lib/runs'
import { pacePieces, paceByGrade } from '../lib/paceClimb'

const W = 320
const M = { left: 40, right: 8 }
const ALT_H = 84
const PACE_H = 96
const GAP = 26
const TOP = 8
const H = TOP + ALT_H + GAP + PACE_H + 22

const percentile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]

/**
 * Altitude and pace along the run, one above the other with the same distance axis, so a slow stretch lines up with the
 * climb it was on. Faster is drawn higher in the pace panel. Touch or hover to read one spot. Under the charts: your average
 * pace uphill, on the flat and downhill.
 */
export default function PaceClimbChart({ track }: { track: TrackPoint[] }) {
  const pieces = pacePieces(track)
  const [at, setAt] = useState<number | null>(null)
  const withAlt = pieces.filter((p) => p.alt !== null)
  if (pieces.length < 5 || withAlt.length < 5) return null

  const maxKm = pieces[pieces.length - 1].km + 0.05
  const x = (km: number) => M.left + (km / maxKm) * (W - M.left - M.right)

  const alts = withAlt.map((p) => p.alt as number)
  const aLo = Math.min(...alts)
  const aHi = Math.max(...alts)
  const aSpan = Math.max(aHi - aLo, 10) // a flat run is not stretched into a mountain
  const altY = (v: number) => TOP + ALT_H - ((v - aLo) / aSpan) * ALT_H

  // the pace scale ignores the extreme 5 % at each end (a stop, a sprint), which are drawn at the edge instead of squashing the rest
  const paces = pieces.map((p) => p.pace).sort((a, b) => a - b)
  const fast = percentile(paces, 0.05)
  const slow = percentile(paces, 0.95)
  const pSpan = Math.max(slow - fast, 20)
  const paceTop = TOP + ALT_H + GAP
  const paceY = (v: number) => paceTop + ((Math.min(slow, Math.max(fast, v)) - fast) / pSpan) * PACE_H // faster = higher

  // pace is smoothed over three pieces (300 m): a single piece is noisy
  const smooth = pieces.map((p, i) => {
    const w = pieces.slice(Math.max(0, i - 1), i + 2)
    return { km: p.km, pace: w.reduce((s, q) => s + q.pace, 0) / w.length }
  })
  const paceLine = smooth.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.km).toFixed(1)},${paceY(p.pace).toFixed(1)}`).join(' ')
  const altLine = withAlt.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.km).toFixed(1)},${altY(p.alt as number).toFixed(1)}`).join(' ')
  const altArea = `${altLine} L${x(withAlt[withAlt.length - 1].km).toFixed(1)},${TOP + ALT_H} L${x(withAlt[0].km).toFixed(1)},${TOP + ALT_H} Z`

  function point(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const km = ((((e.clientX - box.left) / box.width) * W - M.left) / (W - M.left - M.right)) * maxKm
    let best = 0
    pieces.forEach((p, i) => {
      if (Math.abs(p.km - km) < Math.abs(pieces[best].km - km)) best = i
    })
    setAt(best)
  }

  const sel = at !== null ? pieces[at] : null
  const groups = paceByGrade(pieces)
  const paceBase = TOP + ALT_H + GAP + PACE_H

  return (
    <>
      <div className="pc-legend">
        <span>
          <i className="swatch" style={{ background: 'var(--chart)' }} /> Altitude, m
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--you)' }} /> Pace per km, faster is up
        </span>
      </div>
      <div className="pc-readout" aria-live="polite">
        {sel ? (
          <>
            <strong>{sel.km.toFixed(2)} km</strong> · {formatPace(sel.pace)} /km
            {sel.alt !== null && <> · {Math.round(sel.alt)} m</>}
            {sel.grade !== null && (
              <>
                {' '}
                · {sel.grade > 0 ? '+' : ''}
                {sel.grade.toFixed(1)}%
              </>
            )}
          </>
        ) : (
          <span className="muted">Touch the charts to read one spot.</span>
        )}
      </div>
      <svg
        className="profile"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Altitude from ${Math.round(aLo)} to ${Math.round(aHi)} metres and pace from ${formatPace(fast)} to ${formatPace(slow)} per kilometre, along ${maxKm.toFixed(1)} kilometres`}
        onPointerMove={point}
        onPointerDown={point}
        onPointerLeave={() => setAt(null)}
        style={{ touchAction: 'pan-y' }}
      >
        {/* altitude */}
        <line x1={M.left} x2={W - M.right} y1={TOP} y2={TOP} className="chart-grid" />
        <line x1={M.left} x2={W - M.right} y1={TOP + ALT_H} y2={TOP + ALT_H} className="chart-grid" />
        <path d={altArea} fill="var(--chart)" opacity="0.14" />
        <path d={altLine} fill="none" stroke="var(--chart)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x={M.left - 6} y={TOP + 4} textAnchor="end" className="chart-axis">
          {Math.round(aLo + aSpan)}
        </text>
        <text x={M.left - 6} y={TOP + ALT_H + 4} textAnchor="end" className="chart-axis">
          {Math.round(aLo)}
        </text>

        {/* pace: faster is higher */}
        <line x1={M.left} x2={W - M.right} y1={paceTop} y2={paceTop} className="chart-grid" />
        <line x1={M.left} x2={W - M.right} y1={paceBase} y2={paceBase} className="chart-grid" />
        <path d={paceLine} fill="none" stroke="var(--you)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x={M.left - 6} y={paceTop + 4} textAnchor="end" className="chart-axis">
          {formatPace(fast)}
        </text>
        <text x={M.left - 6} y={paceBase + 4} textAnchor="end" className="chart-axis">
          {formatPace(slow)}
        </text>

        <text x={M.left} y={H - 5} className="chart-axis">
          0
        </text>
        <text x={W - M.right} y={H - 5} textAnchor="end" className="chart-axis">
          {maxKm.toFixed(1)} km
        </text>

        {sel && (
          <>
            <line x1={x(sel.km)} x2={x(sel.km)} y1={TOP} y2={paceBase} stroke="var(--text)" strokeWidth="1" opacity="0.6" />
            {sel.alt !== null && <circle cx={x(sel.km)} cy={altY(sel.alt)} r="4" fill="var(--chart)" stroke="var(--surface)" strokeWidth="2" />}
            <circle cx={x(sel.km)} cy={paceY(sel.pace)} r="4" fill="var(--you)" stroke="var(--surface)" strokeWidth="2" />
          </>
        )}
      </svg>

      {groups && (
        <div className="table run-facts pc-groups">
          {groups.map((g) => (
            <div className="table-row" key={g.label}>
              <span>
                {g.label} <small className="muted">{(g.meters / 1000).toFixed(1)} km</small>
              </span>
              <span>{formatPace(g.pace)} /km</span>
            </div>
          ))}
        </div>
      )}
      <p className="muted note">
        Pace and gradient are worked out over 100 m pieces; slopes are steeper than 2 %. The pace is smoothed over 300 m. GPS altitude is rough, so
        short bumps are not to be trusted.
      </p>
    </>
  )
}
