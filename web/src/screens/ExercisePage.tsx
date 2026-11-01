import { useEffect, useMemo, useState } from 'react'
import LineChart, { type Point } from '../components/LineChart'
import { Page } from '../components/Page'
import { useNav } from '../lib/nav'
import { formatDate, formatDayMonth, kgText, num } from '../lib/format'
import {
  loadExerciseData,
  metricsFor,
  recordsFor,
  type ExerciseData,
  type Metric,
  type SessionHistory,
} from '../lib/exerciseStats'

type Tab = 'stats' | 'records' | 'history'
type Range = '1M' | '3M' | '6M' | '1Y' | 'All'

const RANGES: { id: Range; months: number | null }[] = [
  { id: '1M', months: 1 },
  { id: '3M', months: 3 },
  { id: '6M', months: 6 },
  { id: '1Y', months: 12 },
  { id: 'All', months: null },
]

const inRange = (iso: string, months: number | null) => {
  if (months === null) return true
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  return new Date(iso) >= cutoff
}

function StatsTab({ data }: { data: ExerciseData }) {
  const { info, stats } = data
  const metrics = useMemo(() => metricsFor(info), [info])
  const [metricId, setMetricId] = useState(metrics[0].id)
  const metric: Metric = metrics.find((m) => m.id === metricId) ?? metrics[0]

  // Start on the shortest range that has a line to draw (at least 2 sessions).
  const [range, setRange] = useState<Range>(() => {
    const m = metrics[0]
    const have = (months: number | null) => stats.filter((s) => m.value(s) !== null && inRange(s.startedAt, months)).length
    return RANGES.find((r) => r.id !== '1M' && have(r.months) >= 2)?.id ?? 'All'
  })
  const months = RANGES.find((r) => r.id === range)!.months

  const rows = useMemo(
    () => stats.filter((s) => metric.value(s) !== null && inRange(s.startedAt, months)),
    [stats, metric, months],
  )
  const points: Point[] = rows.map((s) => ({ t: new Date(s.startedAt).getTime(), v: metric.value(s)! }))
  const [picked, setPicked] = useState<number | null>(null)
  const selected = points.length ? Math.min(picked ?? points.length - 1, points.length - 1) : null

  const fmt = (v: number) => (metric.unit === 'reps' ? `${num(v)}` : `${num(v)} kg`)
  const fmtFull = (v: number) => (metric.id === 'weight' ? kgText(v, info) : metric.unit === 'reps' ? `${num(v)} reps` : `${num(v)} kg`)

  return (
    <>
      <div className="chips" role="tablist" aria-label="Metric">
        {metrics.map((m) => (
          <button key={m.id} className={`chip${m.id === metric.id ? ' on' : ''}`} onClick={() => { setMetricId(m.id); setPicked(null) }}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="readout">
        {selected !== null ? (
          <>
            <div className="readout-value">{fmtFull(points[selected].v)}</div>
            <div className="muted">
              {formatDate(rows[selected].startedAt)} · {rows[selected].sets} {rows[selected].sets === 1 ? 'set' : 'sets'}
            </div>
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
          lowerIsBetter={metric.lowerIsBetter}
          ariaLabel={`${metric.label} per session for ${info.name}, ${points.length} sessions, latest ${fmtFull(points[points.length - 1].v)}`}
        />
      ) : (
        <div className="card muted">Nothing to plot in this range. Try a longer one.</div>
      )}

      <div className="chips ranges" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r.id} className={`chip${r.id === range ? ' on' : ''}`} onClick={() => { setRange(r.id); setPicked(null) }}>
            {r.id}
          </button>
        ))}
      </div>
      {metric.lowerIsBetter && <p className="muted note">Lower is better: less assistance means you lift more of your own weight.</p>}
      {info.dumbbellPair && metric.unit === 'kg' && <p className="muted note">Dumbbell exercise: weights are the pair total (2 dumbbells).</p>}
    </>
  )
}

function RecordsTab({ data }: { data: ExerciseData }) {
  const records = recordsFor(data.info, data.stats)
  return (
    <>
      <h2>Personal records</h2>
      {records.length === 0 && <p className="muted">No records yet.</p>}
      {records.map((r) => (
        <div className="card record" key={r.label}>
          <div className="muted">{r.label}</div>
          <div className="readout-value">{r.unit === 'reps' ? `${num(r.value)} reps` : r.pair ? kgText(r.value, data.info) : `${num(r.value)} kg`}</div>
          <div className="muted">{formatDate(r.startedAt)}</div>
        </div>
      ))}

      {data.repsAtWeight.length > 0 && (
        <>
          <h2>Best reps at each weight</h2>
          <div className="card table">
            <div className="table-row head">
              <span>Weight</span>
              <span>Reps</span>
              <span>Last time</span>
            </div>
            {data.repsAtWeight.map((r) => (
              <div className="table-row" key={r.weightKg}>
                <span>{kgText(r.weightKg, data.info)}</span>
                <span>{r.reps}</span>
                <span className="muted">{formatDayMonth(r.startedAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/** "44×6 · 44×6 · 44×4", left/right as "7.5×11/10", warm-ups marked W. */
export function setsLine(h: SessionHistory) {
  const bySetNo = new Map<number, SessionHistory['sets']>()
  for (const s of h.sets) bySetNo.set(s.setNo, [...(bySetNo.get(s.setNo) ?? []), s])
  return [...bySetNo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, rows]) => {
      const sorted = [...rows].sort((x, y) => (x.side ?? '').localeCompare(y.side ?? ''))
      const reps = sorted.map((r) => r.reps ?? '–').join('/')
      const w = sorted[0].weightKg
      return `${sorted[0].isWarmup ? 'W ' : ''}${w === null ? '' : num(w) + '×'}${reps}`
    })
    .join(' · ')
}

function HistoryTab({ data }: { data: ExerciseData }) {
  const { push } = useNav()
  return (
    <>
      {data.history.length === 0 && <p className="muted">Never done.</p>}
      {data.history.map((h) => (
        <button className="card list-item" key={h.sessionId} onClick={() => push({ type: 'session', id: h.sessionId })}>
          <span className="routine-title">{formatDate(h.startedAt)}</span>
          <span className="muted">{h.title}</span>
          <span className="sets-line">{setsLine(h)}</span>
        </button>
      ))}
    </>
  )
}

export default function ExercisePage({ id }: { id: string }) {
  const { push } = useNav()
  const [data, setData] = useState<ExerciseData | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('stats')

  useEffect(() => {
    loadExerciseData(id)
      .then((r) => {
        setData(r.data)
        setOffline(r.offline)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e?.message ?? e)))
  }, [id])

  const subtitle = data
    ? [
        data.info.equipment,
        data.info.dumbbellPair ? 'pair of dumbbells' : null,
        data.info.unilateral ? 'one side at a time' : null,
        data.info.loadType === 'assisted' ? 'assisted' : data.info.loadType === 'bodyweight' ? 'bodyweight' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <Page
      title={data?.info.name ?? 'Exercise'}
      action={
        data && (
          <button className="link edit-link" onClick={() => push({ type: 'exerciseForm', id })}>
            Edit
          </button>
        )
      }
    >
      {error && <div className="card error">Could not load this exercise: {error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          {subtitle && <p className="muted subtitle">{subtitle}</p>}
          {offline && <p className="muted">No signal: showing the last copy saved on this phone.</p>}
          <div className="segmented" role="tablist">
            {(['stats', 'records', 'history'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'stats' ? 'Stats' : t === 'records' ? 'Records' : 'History'}
              </button>
            ))}
          </div>
          {data.stats.length === 0 && tab !== 'history' ? (
            <div className="card muted">No finished sessions with this exercise yet.</div>
          ) : tab === 'stats' ? (
            <StatsTab data={data} />
          ) : tab === 'records' ? (
            <RecordsTab data={data} />
          ) : (
            <HistoryTab data={data} />
          )}
        </>
      )}
    </Page>
  )
}
