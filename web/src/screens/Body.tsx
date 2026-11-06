import { useCallback, useEffect, useMemo, useState } from 'react'
import TimeChart, { type Series } from '../components/TimeChart'
import { useNav } from '../lib/nav'
import { dayToTime, FIELDS, loadBody, saveHeight, type BodyData, type Checkin, type LatestRow, type MetricRow } from '../lib/checkins'
import { formatDate, formatDayMonth, num } from '../lib/format'
import { createWatchPairing, type Pairing } from '../lib/pairing'
import PairWatchSheet from '../components/PairWatchSheet'
import MusclePeriods from '../components/MusclePeriods'

/** One chart series per metric, from the view body_metrics (stored measurements and calculated ones), oldest point first. */
const buildSeries = (metrics: MetricRow[], checkins: Checkin[]): Series[] => {
  const notesByDay = new Map(checkins.filter((c) => c.notes).map((c) => [c.checkedOn, c.notes as string]))
  const byMetric = new Map<string, Series & { ord: number }>()
  for (const m of metrics) {
    let s = byMetric.get(m.metric)
    if (!s) {
      s = { id: m.metric, label: m.label, unit: m.unit === 'x' ? '' : m.unit, group: m.group, points: [], ord: m.ord }
      byMetric.set(m.metric, s)
    }
    s.points.push({ t: dayToTime(m.day), v: m.value, sub: notesByDay.get(m.day) })
  }
  return [...byMetric.values()].sort((a, b) => a.ord - b.ord)
}

/** "Bodyweight 78.5 kg · Waist 80 cm ... + 3 more": the first few numbers of a check-in. */
const entrySummary = (c: Checkin) => {
  const filled = FIELDS.filter((f) => c.values[f.col] !== null)
  if (filled.length === 0) return 'no numbers'
  const shown = filled.slice(0, 4).map((f) => `${f.label.split(' (')[0]} ${num(c.values[f.col])}${f.unit === '%' ? '%' : ' ' + f.unit}`)
  return shown.join(' · ') + (filled.length > 4 ? ` · +${filled.length - 4} more` : '')
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`

/** The measurements table: every metric's latest value against about four weeks earlier, grouped. */
function Measurements({ latest }: { latest: LatestRow[] }) {
  const groups = [...new Set(latest.map((l) => l.group))]
  return (
    <div className="card table measures">
      <div className="table-row head">
        <span>Measurement</span>
        <span>Latest</span>
        <span>vs ~4 weeks</span>
      </div>
      {groups.map((g) => (
        <div key={g}>
          <div className="measure-group">{g}</div>
          {latest
            .filter((l) => l.group === g)
            .map((l) => {
              const unit = l.unit === 'x' ? '' : l.unit === '%' ? '%' : ` ${l.unit}`
              return (
                <div className="table-row" key={l.metric} title={`as of ${formatDate(`${l.latestOn}T12:00:00`)}`}>
                  <span>{l.label}</span>
                  <span>
                    {num(l.latestValue)}
                    {unit}
                  </span>
                  <span className="muted">
                    {l.change === null ? '–' : `${l.change > 0 ? '▲' : l.change < 0 ? '▼' : '＝'} ${signed(l.change)}${unit}`}
                  </span>
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}

export default function Body() {
  const { push } = useNav()
  const [data, setData] = useState<(BodyData & { offline: boolean }) | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    loadBody()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e?.message ?? e)))
  }, [])
  useEffect(load, [load])

  const series = useMemo(() => (data ? buildSeries(data.metrics, data.checkins) : []), [data])

  // height, once: it only feeds the ratios that need it
  const [editingHeight, setEditingHeight] = useState(false)
  const [heightText, setHeightText] = useState('')
  const [heightError, setHeightError] = useState<string | null>(null)
  async function submitHeight() {
    const v = parseFloat(heightText.replace(',', '.'))
    if (Number.isNaN(v) || v < 100 || v > 250) return setHeightError('Height in cm, between 100 and 250.')
    try {
      await saveHeight(v)
      setEditingHeight(false)
      setHeightError(null)
      load()
    } catch (e) {
      setHeightError(e instanceof Error ? e.message : String(e))
    }
  }

  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [pairBusy, setPairBusy] = useState(false)
  const [pairError, setPairError] = useState<string | null>(null)
  async function makeCode() {
    setPairBusy(true)
    setPairError(null)
    try {
      setPairing(await createWatchPairing())
    } catch (e) {
      setPairError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e))
    }
    setPairBusy(false)
  }

  const checkins = data?.checkins ?? null

  return (
    <>
      <div className="title-row">
        <h1>Body</h1>
        <button className="chip on" onClick={() => push({ type: 'checkinForm' })}>
          + Check-in
        </button>
      </div>
      {error && <div className="card error">Could not load: {error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data?.offline && <p className="muted">No signal: showing the last copy saved on this phone.</p>}

      {data && checkins && (
        <>
          <TimeChart key={data.metrics.length} series={series} name="your body" />

          {data.heightCm !== null && (
            <button className="card list-item" onClick={() => push({ type: 'shape' })}>
              <span className="routine-title">Shape vs target</span>
              <span className="muted">Your measurements as a figure over the target, and the gap for each part.</span>
            </button>
          )}

          <MusclePeriods />

          <h2>Measurements</h2>
          <div className="card height-card">
            {editingHeight ? (
              <>
                <label>
                  Height (cm)
                  <input inputMode="decimal" autoFocus value={heightText} onChange={(e) => setHeightText(e.target.value)} placeholder="170" />
                </label>
                {heightError && <p className="error">{heightError}</p>}
                <button className="primary" onClick={submitHeight}>
                  Save height
                </button>
                <button className="link" onClick={() => setEditingHeight(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <div className="height-row">
                <span>
                  Height <strong>{data.heightCm === null ? 'not set' : `${num(data.heightCm)} cm`}</strong>
                </span>
                <button
                  className="link"
                  onClick={() => {
                    setHeightText(data.heightCm === null ? '' : num(data.heightCm))
                    setEditingHeight(true)
                  }}
                >
                  {data.heightCm === null ? 'Add' : 'Edit'}
                </button>
              </div>
            )}
            {data.heightCm === null && !editingHeight && (
              <p className="muted note">Add your height to get waist / height and the body fat estimate from the tape.</p>
            )}
          </div>
          {data.latest.length > 0 ? (
            <>
              <Measurements latest={data.latest} />
              <p className="muted note">
                Compared with the latest check-in at least 25 days earlier. “Calculated” rows come from your other numbers: shoulders / waist is your
                V-taper, and the body fat from the tape is a rough estimate (a few points either way): read its trend, not the number.
              </p>
            </>
          ) : (
            <p className="muted">No measurements yet. Log a check-in.</p>
          )}

          {data.weeks.length > 0 && (
            <>
              <h2>Last weeks</h2>
              <div className="card table weeks">
                <div className="table-row head">
                  <span>Week of</span>
                  <span>Sessions</span>
                  <span>Weight</span>
                  <span>Sleep</span>
                  <span>Plan</span>
                </div>
                {data.weeks.map((w) => (
                  <div className="table-row" key={w.weekStart}>
                    <span>{formatDayMonth(`${w.weekStart}T12:00:00`)}</span>
                    <span>{w.sessions}</span>
                    <span>{w.bodyweightKg === null ? '–' : num(w.bodyweightKg)}</span>
                    <span>{w.sleepHours === null ? '–' : `${num(w.sleepHours)} h`}</span>
                    <span title="sets that reached the planned reps, out of sets done">{w.doneSets ? `${w.metSets}/${w.doneSets}` : '–'}</span>
                  </div>
                ))}
              </div>
              <p className="muted note">
                Plan = sets that reached the planned reps at the planned weight, out of the sets you did (only workouts logged in this app). This
                is what Claude reads to judge how you are recovering.
              </p>
            </>
          )}

          <h2>Check-ins</h2>
          {checkins.length === 0 && <p className="muted">No check-ins yet. Log one to start the charts.</p>}
          {checkins.map((c) => (
            <button className="card list-item" key={c.id} onClick={() => push({ type: 'checkinForm', id: c.id })}>
              <span className="routine-title">{formatDate(`${c.checkedOn}T12:00:00`)}</span>
              <span className="muted">{entrySummary(c)}</span>
              {c.notes && <span className="muted note">“{c.notes}”</span>}
            </button>
          ))}
        </>
      )}

      <h2>Watch</h2>
      <div className="card">
        <p className="muted">Sign the watch in without typing a password: make a code here and pick it on the watch.</p>
        {pairError && !pairing && <p className="error">{pairError}</p>}
        <button className="outline" disabled={pairBusy} onClick={makeCode}>
          {pairBusy ? 'Making a code…' : 'Pair watch'}
        </button>
      </div>
      {pairing && (
        <PairWatchSheet pairing={pairing} busy={pairBusy} error={pairError} onNewCode={makeCode} onClose={() => setPairing(null)} />
      )}
    </>
  )
}
