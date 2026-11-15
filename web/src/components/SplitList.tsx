import { formatPace, type RunSplit } from '../lib/runs'

/** One row per kilometre: the bar is the speed (longer = faster), the number is the pace; the fastest kilometre is marked. */
export default function SplitList({ splits }: { splits: RunSplit[] }) {
  // a last bit shorter than 100 m gives a meaningless pace, so it is left out
  const rows = splits.filter((s) => s.distanceM >= 100 && s.seconds > 0).map((s) => ({ ...s, pace: s.seconds / (s.distanceM / 1000) }))
  if (rows.length === 0) return null
  const fastest = Math.min(...rows.map((r) => r.pace))
  const full = rows.filter((r) => r.distanceM >= 999.5)
  // no "fastest" when every kilometre is the same (an even pace was assumed because the GPS did not work)
  const spread = full.length > 1 ? Math.max(...full.map((r) => r.pace)) - Math.min(...full.map((r) => r.pace)) : 0
  const best = spread >= 1 ? Math.min(...full.map((r) => r.pace)) : null
  const anyHr = rows.some((r) => r.avgHr !== null)
  return (
    <ul className={`split-list${anyHr ? ' with-hr' : ''}`}>
      {rows.map((r) => (
        <li key={r.km} className={r.pace === best ? 'best' : ''}>
          <span className="sp-km">{r.distanceM >= 999.5 ? r.km : `${(r.distanceM / 1000).toFixed(2)}`}</span>
          <span className="mb-track" role="img" aria-label={`Kilometre ${r.km}: ${formatPace(r.pace)} per km${r.pace === best ? ', the fastest' : ''}`}>
            <span className="sp-fill" style={{ width: `${(fastest / r.pace) * 100}%` }} />
          </span>
          <span className="sp-pace">{formatPace(r.pace)}</span>
          {anyHr && <span className="sp-hr muted">{r.avgHr === null ? '' : `${r.avgHr} bpm`}</span>}
        </li>
      ))}
    </ul>
  )
}
