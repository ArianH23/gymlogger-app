import { useId } from 'react'
import { BACK, FIGURE, FRONT, musclesOf, VIEW_CROP_W, VIEW_H, VIEW_X } from '../lib/muscleFigure'
import type { MuscleRow } from '../lib/muscles'
import { num } from '../lib/format'

const HOT = '#3987e5'
const BODY = '#232a27'
const VIEWS = [
  { name: 'Front', muscles: musclesOf(FRONT) },
  { name: 'Back', muscles: musclesOf(BACK) },
]

/** Front and back view with every muscle drawn in, and the ones that got sets painted blue: the more sets, the stronger. */
export default function MuscleFigure({ rows }: { rows: MuscleRow[] }) {
  const id = useId().replace(/:/g, '')
  const max = Math.max(0, ...rows.map((r) => r.sets))
  const setsBy = new Map(rows.map((r) => [r.muscle, r.sets]))
  const summary = rows.length
    ? `Muscles worked, most sets first: ${rows.map((r) => `${r.label} ${num(r.sets)}`).join(', ')}`
    : 'No muscles worked'

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
      {VIEWS.map((view, v) => (
        <g key={view.name} transform={`translate(${v * VIEW_CROP_W - VIEW_X}, 0)`}>
          <g fill={BODY}>
            {FIGURE.paths.map((d, i) => (
              <path key={i} d={d} />
            ))}
            <ellipse cx={FIGURE.head.cx} cy={FIGURE.head.cy} rx={FIGURE.head.rx} ry={FIGURE.head.ry} />
          </g>
          {/* every muscle faintly, so the body reads as a body; the worked ones in blue, with a thin gap between neighbours */}
          <g clipPath={`url(#clip-${id})`} stroke={BODY} strokeWidth="2.5" strokeLinejoin="round">
            {view.muscles.map(({ muscle, paths }) => {
              const sets = setsBy.get(muscle) ?? 0
              const worked = sets > 0 && max > 0
              return paths.map((d, i) => (
                <path key={`${muscle}-${i}`} d={d} fill={worked ? HOT : '#ffffff'} fillOpacity={worked ? 0.35 + 0.65 * (sets / max) : 0.055} />
              ))
            })}
          </g>
          <text x={FIGURE.cx} y={VIEW_H - 4} fontSize="20" fill="#8e9992" textAnchor="middle">
            {view.name}
          </text>
        </g>
      ))}
    </svg>
  )
}
