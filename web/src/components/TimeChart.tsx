import { useMemo, useState } from 'react'
import LineChart, { type Point } from './LineChart'
import { formatDate, num } from '../lib/format'

export type Series = {
  id: string
  label: string
  unit: string // shown after the number, e.g. "kg"
  lowerIsBetter?: boolean
  points: (Point & { sub?: string })[] // oldest first
}

type Range = '1M' | '3M' | '6M' | '1Y' | 'All'
const RANGES: { id: Range; months: number | null }[] = [
  { id: '1M', months: 1 },
  { id: '3M', months: 3 },
  { id: '6M', months: 6 },
  { id: '1Y', months: 12 },
  { id: 'All', months: null },
]

const inRange = (t: number, months: number | null) => {
  if (months === null) return true
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  return t >= cutoff.getTime()
}

/** Metric chips, the selected point, the chart and the time range, for one or more series over time. */
export default function TimeChart({ series, name }: { series: Series[]; name: string }) {
  const usable = useMemo(() => series.filter((s) => s.points.length > 0), [series])
  const [seriesId, setSeriesId] = useState(usable[0]?.id)
  const current = usable.find((s) => s.id === seriesId) ?? usable[0]

  const [range, setRange] = useState<Range>(() => {
    const first = usable[0]
    if (!first) return 'All'
    const have = (months: number | null) => first.points.filter((p) => inRange(p.t, months)).length
    return RANGES.find((r) => r.id !== '1M' && have(r.months) >= 2)?.id ?? 'All'
  })
  const months = RANGES.find((r) => r.id === range)!.months
  const points = useMemo(() => (current ? current.points.filter((p) => inRange(p.t, months)) : []), [current, months])
  const [picked, setPicked] = useState<number | null>(null)
  const selected = points.length ? Math.min(picked ?? points.length - 1, points.length - 1) : null

  if (!current) return <div className="card muted">Nothing to plot yet. Log a check-in to start the chart.</div>
  const fmt = (v: number) => `${num(v)}${current.unit ? ' ' + current.unit : ''}`

  return (
    <>
      <div className="chips" role="tablist" aria-label="Measurement">
        {usable.map((s) => (
          <button
            key={s.id}
            className={`chip${s.id === current.id ? ' on' : ''}`}
            onClick={() => {
              setSeriesId(s.id)
              setPicked(null)
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="readout">
        {selected !== null ? (
          <>
            <div className="readout-value">{fmt(points[selected].v)}</div>
            <div className="muted">{formatDate(new Date(points[selected].t).toISOString())}{points[selected].sub ? ` · ${points[selected].sub}` : ''}</div>
          </>
        ) : (
          <div className="muted">No data in this range</div>
        )}
      </div>

      {points.length > 0 ? (
        <LineChart
          points={points}
          selected={selected}
          onSelect={setPicked}
          formatValue={fmt}
          formatTick={(v) => num(v)}
          lowerIsBetter={current.lowerIsBetter}
          ariaLabel={`${current.label} over time for ${name}, ${points.length} entries, latest ${fmt(points[points.length - 1].v)}`}
        />
      ) : (
        <div className="card muted">Nothing in this range. Try a longer one.</div>
      )}

      <div className="chips ranges" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r.id}
            className={`chip${r.id === range ? ' on' : ''}`}
            onClick={() => {
              setRange(r.id)
              setPicked(null)
            }}
          >
            {r.id}
          </button>
        ))}
      </div>
    </>
  )
}
