import { useEffect, useState } from 'react'
import { Skeleton } from './Skeleton'
import { useNav } from '../lib/nav'
import { formatDuration, formatPace, loadRunTrends, type RunBest, type RunTrends as Trends } from '../lib/runs'
import { formatDayMonth } from '../lib/format'

const BEST_LABEL: Record<RunBest['kind'], string> = { best_5k: 'Fastest 5 km', best_1k: 'Fastest kilometre', longest: 'Longest run' }
const ORDER: RunBest['kind'][] = ['best_5k', 'best_1k', 'longest']

const bestValue = (b: RunBest) => (b.kind === 'longest' ? `${(b.value / 1000).toFixed(2)} km` : b.kind === 'best_1k' ? `${formatPace(b.value)} /km` : formatDuration(b.value))

/** Distance per week as bars (the last 12 weeks that have runs), and your bests. `version` reloads it after an import. */
export default function RunTrends({ version }: { version: number }) {
  const { push } = useNav()
  const [data, setData] = useState<Trends | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadRunTrends()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [version])

  if (failed) return null // a bonus: the list works without it
  if (!data) return <Skeleton h={150} r={18} />
  if (data.weeks.length === 0 && data.bests.length === 0) return null
  const max = Math.max(1, ...data.weeks.map((w) => w.distanceKm))
  const bests = ORDER.map((k) => data.bests.find((b) => b.kind === k)).filter((b): b is RunBest => !!b)

  return (
    <>
      {data.weeks.length > 0 && (
        <div className="card">
          <h2 className="card-h">Distance per week</h2>
          <ul className="muscle-bars week-bars">
            {data.weeks.map((w) => (
              <li key={w.weekStart}>
                <span className="mb-label">{formatDayMonth(`${w.weekStart}T12:00:00`)}</span>
                <span className="mb-track" role="img" aria-label={`Week of ${formatDayMonth(`${w.weekStart}T12:00:00`)}: ${w.distanceKm.toFixed(1)} km in ${w.runs} ${w.runs === 1 ? 'run' : 'runs'}`}>
                  <span className="mb-fill" style={{ width: `${(w.distanceKm / max) * 100}%` }} />
                </span>
                <span className="mb-num">
                  {w.distanceKm.toFixed(1)} <small className="muted">km</small>
                </span>
              </li>
            ))}
          </ul>
          <p className="muted note">Weeks start on Monday. Only weeks with a run are listed.</p>
        </div>
      )}
      {bests.length > 0 && (
        <div className="card table bests">
          {bests.map((b) => (
            <button className="table-row gap-row" key={b.kind} onClick={() => push({ type: 'run', id: b.runId })}>
              <span>{BEST_LABEL[b.kind]}</span>
              <span>
                <strong>{bestValue(b)}</strong>
              </span>
              <span className="muted">{formatDayMonth(`${b.day}T12:00:00`)} ›</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
