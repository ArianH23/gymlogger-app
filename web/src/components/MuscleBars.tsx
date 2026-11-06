import type { MuscleRow } from '../lib/muscles'
import { num } from '../lib/format'

/** One bar per muscle, most sets first: the bar is the sets (primary 1, secondary 0.5 per working set), the number is the share of the total. */
export default function MuscleBars({ rows }: { rows: MuscleRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.sets))
  return (
    <ul className="muscle-bars">
      {rows.map((r) => (
        <li key={r.muscle}>
          <span className="mb-label">{r.label}</span>
          <span className="mb-track" role="img" aria-label={`${r.label}: ${num(r.sets)} sets, ${Math.round(r.share * 100)}% of the total`}>
            <span className="mb-fill" style={{ width: `${(r.sets / max) * 100}%` }} />
          </span>
          <span className="mb-num">
            {num(r.sets)} <small className="muted">{Math.round(r.share * 100)}%</small>
          </span>
        </li>
      ))}
    </ul>
  )
}
