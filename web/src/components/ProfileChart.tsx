const W = 320
const H = 120
const M = { left: 38, right: 8, top: 10, bottom: 22 }

type Props = {
  points: { x: number; y: number }[] // x = km along the run
  color: string
  label: string // what is plotted, for screen readers
  unit: string
}

/** One value along the distance of a run (altitude, heart rate): a thin line over a faint wash, with the low and high marked. */
export default function ProfileChart({ points, color, label, unit }: Props) {
  if (points.length < 2) return null
  const maxX = points[points.length - 1].x || 1
  const ys = points.map((p) => p.y)
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const span = hi - lo || 1
  const px = (x: number) => M.left + (x / maxX) * (W - M.left - M.right)
  const py = (y: number) => H - M.bottom - ((y - lo) / span) * (H - M.top - M.bottom)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ')
  const area = `${line} L${px(maxX).toFixed(1)},${H - M.bottom} L${px(0).toFixed(1)},${H - M.bottom} Z`
  const base = H - M.bottom

  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: from ${Math.round(lo)} to ${Math.round(hi)} ${unit} over ${maxX.toFixed(2)} km`}>
      <line x1={M.left} x2={W - M.right} y1={py(hi)} y2={py(hi)} className="chart-grid" />
      <line x1={M.left} x2={W - M.right} y1={base} y2={base} className="chart-grid" />
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <text x={M.left - 6} y={py(hi) + 4} textAnchor="end" className="chart-axis">
        {Math.round(hi)}
      </text>
      <text x={M.left - 6} y={base + 4} textAnchor="end" className="chart-axis">
        {Math.round(lo)}
      </text>
      <text x={M.left} y={H - 5} className="chart-axis">
        0
      </text>
      <text x={W - M.right} y={H - 5} textAnchor="end" className="chart-axis">
        {maxX.toFixed(1)} km
      </text>
    </svg>
  )
}
