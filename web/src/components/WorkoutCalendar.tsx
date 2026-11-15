import { useEffect, useMemo, useState } from 'react'
import { Skeleton } from './Skeleton'
import { useNav } from '../lib/nav'
import { isoDay, loadMonth, type CalendarSession } from '../lib/calendar'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const monthName = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const dayName = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/** A month at a time, Monday first: gym days filled in jade, run days in blue, a day with both in both. Tap a day to see it. */
export default function WorkoutCalendar() {
  const { push } = useNav()
  const [now] = useState(() => new Date()) // today, fixed when the calendar opens
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [sessions, setSessions] = useState<CalendarSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const key = `gl_calendar_${ym.y}_${ym.m}`
    loadMonth(ym.y, ym.m)
      .then((rows) => {
        if (!alive) return
        setSessions(rows)
        setError(null)
        try {
          localStorage.setItem(key, JSON.stringify(rows))
        } catch {
          // storage full: it still works online
        }
      })
      .catch((e) => {
        if (!alive) return
        const saved = localStorage.getItem(key)
        if (saved) setSessions(JSON.parse(saved) as CalendarSession[])
        else setError(e instanceof Error ? e.message : String(e?.message ?? e))
      })
    return () => {
      alive = false
    }
  }, [ym])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarSession[]>()
    for (const s of sessions ?? []) map.set(s.day, [...(map.get(s.day) ?? []), s])
    return map
  }, [sessions])

  const today = isoDay(now.getFullYear(), now.getMonth(), now.getDate())
  const atCurrentMonth = ym.y === now.getFullYear() && ym.m === now.getMonth()
  const blanks = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7 // Monday first
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const move = (delta: number) => {
    const d = new Date(ym.y, ym.m + delta, 1)
    setSessions(null)
    setSelected(null)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
  }
  const picked = selected ? (byDay.get(selected) ?? []) : []
  const workoutDays = byDay.size

  return (
    <div className="card calendar">
      <div className="period-nav">
        <button className="link" onClick={() => move(-1)} aria-label="Previous month">
          ‹
        </button>
        <strong>{monthName(ym.y, ym.m)}</strong>
        <button className="link" disabled={atCurrentMonth} onClick={() => move(1)} aria-label="Next month">
          ›
        </button>
      </div>
      {error && <p className="error">Could not load: {error}</p>}
      {!sessions && !error && <Skeleton h={250} r={12} />}
      {sessions && (
        <>
          <div className="cal-grid cal-head" aria-hidden="true">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="cal-grid">
            {Array.from({ length: blanks }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = isoDay(ym.y, ym.m, i + 1)
              const entries = byDay.get(day) ?? []
              const count = entries.length
              const gym = entries.filter((e) => e.kind === 'workout').length
              const ran = count - gym
              const what = [gym ? `${gym} ${gym === 1 ? 'workout' : 'workouts'}` : '', ran ? `${ran} ${ran === 1 ? 'run' : 'runs'}` : ''].filter(Boolean).join(' and ')
              const cls = ['cal-day', gym ? 'has' : '', ran ? 'ran' : '', day === today ? 'today' : '', day === selected ? 'sel' : '', day > today ? 'future' : ''].filter(Boolean).join(' ')
              return (
                <button
                  key={day}
                  className={cls}
                  disabled={count === 0}
                  aria-pressed={day === selected}
                  aria-label={`${dayName(day)}, ${what || 'nothing logged'}`}
                  onClick={() => setSelected(day === selected ? null : day)}
                >
                  {i + 1}
                  {count > 1 && <i>{count}</i>}
                </button>
              )
            })}
          </div>
          <div className="shape-legend cal-legend">
            <span>
              <i className="swatch dot start" /> Workout
            </span>
            <span>
              <i className="swatch dot ran" /> Run
            </span>
          </div>
          <p className="muted note cal-foot">
            {workoutDays === 0 ? 'Nothing logged this month.' : `${workoutDays} active ${workoutDays === 1 ? 'day' : 'days'} this month.`}
            {workoutDays > 0 && !selected ? ' Tap a filled day to see it.' : ''}
          </p>
          {selected &&
            picked.map((s) => (
              <button
                className="cal-session"
                key={s.sessionId ?? s.runId}
                onClick={() => (s.runId ? push({ type: 'run', id: s.runId }) : s.sessionId && push({ type: 'session', id: s.sessionId }))}
              >
                <span>
                  <strong>{s.title}</strong>
                  <small className="muted">
                    {s.kind === 'run' ? 'Run' : 'Workout'} · {dayName(s.day)}
                  </small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
        </>
      )}
    </div>
  )
}
