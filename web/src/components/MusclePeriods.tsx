import { useEffect, useState } from 'react'
import { ChartSkeleton } from './Skeleton'
import BalanceBars from './BalanceBars'
import MuscleBars from './MuscleBars'
import MuscleFigure from './MuscleFigure'
import { loadMusclePeriods, type MusclePeriod, type PeriodKind } from '../lib/muscles'
import { formatDayMonth, num } from '../lib/format'

const label = (kind: PeriodKind, start: string) =>
  kind === 'week'
    ? `Week of ${formatDayMonth(`${start}T12:00:00`)}`
    : new Date(`${start}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

/** How the training was spread over the muscles, one week or one month at a time (step back with the arrows). */
export default function MusclePeriods() {
  const [kind, setKind] = useState<PeriodKind>('week')
  const [periods, setPeriods] = useState<MusclePeriod[] | null>(null)
  const [index, setIndex] = useState(0) // 0 = the latest period with data
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    loadMusclePeriods(kind)
      .then((p) => {
        if (!current) return
        setPeriods(p)
        setIndex(0)
        setError(null)
      })
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e?.message ?? e)))
    return () => {
      current = false
    }
  }, [kind])

  const period = periods?.[index]

  return (
    <>
      <h2>Muscles</h2>
      <div className="segmented" role="tablist">
        {(['week', 'month'] as PeriodKind[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? 'on' : ''}
            onClick={() => {
              setPeriods(null)
              setKind(k)
            }}
          >
            {k === 'week' ? 'Weeks' : 'Months'}
          </button>
        ))}
      </div>
      {error && <div className="card error">Could not load: {error}</div>}
      {!periods && !error && <ChartSkeleton height={420} />}
      {periods && periods.length === 0 && <p className="muted">No finished sessions with tagged exercises yet.</p>}
      {periods && period && (
        <div className="card">
          <div className="period-nav">
            <button className="link" disabled={index >= periods.length - 1} onClick={() => setIndex(index + 1)} aria-label="Earlier">
              ‹
            </button>
            <strong>{label(kind, period.start)}</strong>
            <button className="link" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="Later">
              ›
            </button>
          </div>
          <MuscleFigure rows={period.rows} />
          <MuscleBars rows={period.rows} />
          <p className="muted note">
            {num(period.total)} weighted sets: a working set counts 1 for each main muscle and half for each helping muscle. The number after each bar is
            its share of the total.
          </p>
          <BalanceBars rows={period.balance} />
        </div>
      )}
    </>
  )
}
