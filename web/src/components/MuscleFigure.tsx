import { useId } from 'react'
import { BACK, ellipsesFor, FIGURE, FRONT, VIEW_CROP_W, VIEW_H, VIEW_X } from '../lib/muscleFigure'
import type { MuscleRow } from '../lib/muscles'
import { num } from '../lib/format'

const HOT = '#3987e5'

/** Front and back view with the muscles that got sets painted in: the more sets, the darker. */
export default function MuscleFigure({ rows }: { rows: MuscleRow[] }) {
  const id = useId().replace(/:/g, '')
  const max = Math.max(0, ...rows.map((r) => r.sets))
  const summary = rows.length
    ? `Muscles worked, most sets first: ${rows.map((r) => `${r.label} ${num(r.sets)}`).join(', ')}`
    : 'No muscles worked'

  const view = (layout: typeof FRONT, dx: number, name: string) => (
    <g transform={`translate(${dx - VIEW_X}, 0)`}>
      <g fill="#2f3542">
        {FIGURE.paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
        <ellipse cx={FIGURE.head.cx} cy={FIGURE.head.cy} rx={FIGURE.head.rx} ry={FIGURE.head.ry} />
      </g>
      <g clipPath={`url(#clip-${id})`}>
        {rows.map((r) =>
          ellipsesFor(layout, r.muscle).map((e, i) => (
            <ellipse key={`${r.muscle}-${i}`} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={HOT} opacity={max ? 0.3 + 0.65 * (r.sets / max) : 0} />
          )),
        )}
      </g>
      <text x={FIGURE.cx} y={VIEW_H - 4} fontSize="20" fill="#8d94a5" textAnchor="middle">
        {name}
      </text>
    </g>
  )

  return (
    <svg className="muscle-fig" viewBox={`0 0 ${VIEW_CROP_W * 2} ${VIEW_H}`} role="img" aria-label={summary}>
      <defs>
        <clipPath id={`clip-${id}`}>
          {FIGURE.paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
          <ellipse cx={FIGURE.head.cx} cy={FIGURE.head.cy} rx={FIGURE.head.rx} ry={FIGURE.head.ry} />
        </clipPath>
      </defs>
      {view(FRONT, 0, 'Front')}
      {view(BACK, VIEW_CROP_W, 'Back')}
    </svg>
  )
}
