import { useEffect, useMemo, useState } from 'react'
import TimeChart, { type Series } from '../components/TimeChart'
import { useNav } from '../lib/nav'
import { dayToTime, loadBody, type Checkin, type WeekRow } from '../lib/checkins'
import { formatDate, formatDayMonth, num } from '../lib/format'

const series = (checkins: Checkin[]): Series[] => {
  const asc = [...checkins].reverse()
  const build = (id: string, label: string, unit: string, pick: (c: Checkin) => number | null): Series => ({
    id,
    label,
    unit,
    points: asc.flatMap((c) => (pick(c) === null ? [] : [{ t: dayToTime(c.checkedOn), v: pick(c)!, sub: c.notes ?? undefined }])),
  })
  return [
    build('weight', 'Bodyweight', 'kg', (c) => c.bodyweightKg),
    build('waist', 'Waist', 'cm', (c) => c.waistCm),
    build('sleep', 'Sleep', 'h', (c) => c.sleepHours),
    build('fat', 'Body fat', '%', (c) => c.bodyFatPct),
  ]
}

const entrySummary = (c: Checkin) =>
  [
    c.bodyweightKg !== null && `${num(c.bodyweightKg)} kg`,
    c.waistCm !== null && `waist ${num(c.waistCm)} cm`,
    c.sleepHours !== null && `sleep ${num(c.sleepHours)} h`,
    c.bodyFatPct !== null && `${num(c.bodyFatPct)}% fat`,
  ]
    .filter(Boolean)
    .join(' · ') || 'no numbers'

export default function Body() {
  const { push } = useNav()
  const [checkins, setCheckins] = useState<Checkin[] | null>(null)
  const [weeks, setWeeks] = useState<WeekRow[]>([])
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadBody()
      .then((r) => {
        setCheckins(r.checkins)
        setWeeks(r.weeks)
        setOffline(r.offline)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e?.message ?? e)))
  }, [])

  const all = useMemo(() => series(checkins ?? []), [checkins])

  return (
    <>
      <div className="title-row">
        <h1>Body</h1>
        <button className="chip on" onClick={() => push({ type: 'checkinForm' })}>
          + Check-in
        </button>
      </div>
      {error && <div className="card error">Could not load: {error}</div>}
      {!checkins && !error && <p className="muted">Loading…</p>}
      {offline && <p className="muted">No signal: showing the last copy saved on this phone.</p>}

      {checkins && (
        <>
          <TimeChart key={checkins.length} series={all} name="your body" />

          {weeks.length > 0 && (
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
                {weeks.map((w) => (
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
    </>
  )
}
