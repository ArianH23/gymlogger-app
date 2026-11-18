import { useEffect, useState } from 'react'
import { PageSkeleton } from '../components/Skeleton'
import { Page } from '../components/Page'
import { supabase } from '../lib/supabase'
import { useNav } from '../lib/nav'
import { formatDate, num } from '../lib/format'
import { loadScores, type Score } from '../lib/score'
import ScoreBadge from '../components/ScoreBadge'
import MuscleBars from '../components/MuscleBars'
import MuscleFigure from '../components/MuscleFigure'
import ProfileChart from '../components/ProfileChart'
import { loadSessionMuscles, type MuscleRow } from '../lib/muscles'

type SetRow = {
  exercise_id: string
  set_no: number
  side: 'L' | 'R' | null
  weight_kg: number | null
  reps: number | null
  is_warmup: boolean
  logged_at: string
  exercises: { name: string; dumbbell_pair: boolean; load_type: string }
}

export type Session = {
  id: string
  title: string
  started_at: string
  ended_at: string | null
  notes: string | null
  // heart rate, when the watch recorded it: the average, the highest, and [seconds from the start, bpm] every 10 seconds
  avg_hr_bpm?: number | null
  max_hr_bpm?: number | null
  hr_track?: [number, number][] | null
}

export type Block = {
  exerciseId: string
  name: string
  dumbbellPair: boolean
  loadType: string
  first: string
  // peak / drop: the heart rate around the set and how far it fell in the rest after it (view set_heart_rate), when recorded
  sets: { setNo: number; weight: number | null; reps: string; warmup: boolean; peak?: number | null; drop?: number | null }[]
  note?: string
}

export type Loaded = { session: Session; blocks: Block[]; sets: number; volume: number; score: Score | null }

export async function loadSession(id: string): Promise<Loaded> {
  const [s, sets, notes, scores, hr] = await Promise.all([
    supabase.from('sessions').select('id, title, started_at, ended_at, notes, avg_hr_bpm, max_hr_bpm, hr_track').eq('id', id).single(),
    supabase
      .from('sets')
      .select('exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at, exercises(name, dumbbell_pair, load_type)')
      .eq('session_id', id)
      .is('deleted_at', null),
    supabase.from('session_exercise_notes').select('exercise_id, note').eq('session_id', id).is('deleted_at', null),
    loadScores([id]).catch(() => new Map<string, Score>()), // the score is a bonus: never block the page on it
    supabase.from('set_heart_rate').select('exercise_id, set_no, peak_bpm, drop_bpm').eq('session_id', id),
  ])
  for (const r of [s, sets, notes]) if (r.error) throw r.error
  // the heart rate per set is a bonus too: without it the page shows the sets as before
  const hrBy = new Map((hr.data ?? []).map((h) => [`${h.exercise_id}|${h.set_no}`, { peak: h.peak_bpm as number | null, drop: h.drop_bpm as number | null }]))

  const noteBy = new Map((notes.data ?? []).map((n) => [n.exercise_id as string, n.note as string]))
  const byEx = new Map<string, SetRow[]>()
  for (const r of (sets.data ?? []) as unknown as SetRow[]) byEx.set(r.exercise_id, [...(byEx.get(r.exercise_id) ?? []), r])

  let setCount = 0
  let volume = 0
  const blocks: Block[] = [...byEx.entries()].map(([exerciseId, rows]) => {
    const bySetNo = new Map<number, SetRow[]>()
    for (const r of rows) bySetNo.set(r.set_no, [...(bySetNo.get(r.set_no) ?? []), r])
    const sets = [...bySetNo.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([setNo, rs]) => {
        const sorted = [...rs].sort((x, y) => (x.side ?? '').localeCompare(y.side ?? ''))
        const warmup = sorted[0].is_warmup
        const lowest = Math.min(...sorted.map((r) => r.reps ?? 0))
        if (!warmup) {
          setCount += 1
          if (rows[0].exercises.load_type !== 'assisted') volume += (sorted[0].weight_kg ?? 0) * lowest // assistance is not load that was lifted
        }
        const h = hrBy.get(`${exerciseId}|${setNo}`)
        return { setNo, weight: sorted[0].weight_kg, reps: sorted.map((r) => r.reps ?? '–').join(' / '), warmup, peak: h?.peak ?? null, drop: h?.drop ?? null }
      })
    return {
      exerciseId,
      name: rows[0].exercises.name,
      dumbbellPair: rows[0].exercises.dumbbell_pair,
      loadType: rows[0].exercises.load_type,
      first: rows.map((r) => r.logged_at).sort()[0],
      sets,
      note: noteBy.get(exerciseId),
    }
  })
  blocks.sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name))
  return { session: s.data as Session, blocks, sets: setCount, volume, score: scores.get(id) ?? null }
}

export function duration(a: string, b: string | null) {
  if (!b) return null
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m > 0 && m < 600 ? `${m} min` : null
}

export default function SessionPage({ id }: { id: string }) {
  const { push } = useNav()
  const [data, setData] = useState<Loaded | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muscles, setMuscles] = useState<MuscleRow[]>([])

  // the muscles are a bonus like the score: a failure here never blocks the page; the last copy is kept for offline use
  useEffect(() => {
    const key = `gl_session_muscles_${id}`
    loadSessionMuscles(id)
      .then((m) => {
        setMuscles(m)
        try {
          localStorage.setItem(key, JSON.stringify(m))
        } catch {
          // storage full: still works online
        }
      })
      .catch(() => {
        const saved = localStorage.getItem(key)
        if (saved) setMuscles(JSON.parse(saved) as MuscleRow[])
      })
  }, [id])

  useEffect(() => {
    const key = `gl_session_${id}`
    loadSession(id)
      .then((d) => {
        setData(d)
        try {
          localStorage.setItem(key, JSON.stringify(d))
        } catch {
          // storage full: still works online
        }
      })
      .catch((e) => {
        const saved = localStorage.getItem(key)
        if (saved) {
          setData(JSON.parse(saved) as Loaded)
          setOffline(true)
        } else setError(e instanceof Error ? e.message : String(e?.message ?? e))
      })
  }, [id])

  const s = data?.session
  const mins = s ? duration(s.started_at, s.ended_at) : null

  return (
    <Page
      title={s?.title ?? 'Session'}
      action={
        data && (
          <button className="link edit-link" onClick={() => push({ type: 'sessionEdit', id })}>
            Edit
          </button>
        )
      }
    >
      {error && <div className="card error">Could not load this session: {error}</div>}
      {!data && !error && <PageSkeleton />}
      {offline && <p className="muted">No signal: showing the last copy saved on this phone.</p>}
      {data && s && (
        <>
          <p className="muted subtitle">{formatDate(s.started_at)}</p>
          <div className="stat-row">
            <div className="stat">
              <div className="stat-value">{mins ?? '–'}</div>
              <div className="muted">duration</div>
            </div>
            <div className="stat">
              <div className="stat-value">{data.sets}</div>
              <div className="muted">sets</div>
            </div>
            <div className="stat">
              <div className="stat-value">{data.volume >= 10000 ? `${(data.volume / 1000).toFixed(1)}t` : `${Math.round(data.volume)} kg`}</div>
              <div className="muted">volume</div>
            </div>
          </div>
          <ScoreBadge score={data.score} size="large" />
          {s.notes && <div className="card">{s.notes}</div>}
          {s.avg_hr_bpm != null && (
            <div className="card">
              <h2 className="card-h">Heart rate</h2>
              <div className="table run-facts hr-facts">
                <div className="table-row">
                  <span>Average</span>
                  <span>{s.avg_hr_bpm} bpm</span>
                </div>
                {s.max_hr_bpm != null && (
                  <div className="table-row">
                    <span>Highest</span>
                    <span>{s.max_hr_bpm} bpm</span>
                  </div>
                )}
              </div>
              {s.hr_track && s.hr_track.length > 1 && (
                <ProfileChart points={s.hr_track.map(([t, bpm]) => ({ x: t / 60, y: bpm }))} color="var(--target)" label="Heart rate" unit="bpm" xUnit="min" />
              )}
              <p className="muted note">
                Recorded by the watch while the workout was open on it. Each set below shows its peak, and after the arrow how far the heart rate fell in
                the rest that followed.
              </p>
            </div>
          )}
          {muscles.length > 0 && (
            <div className="card">
              <h2 className="card-h">Muscles worked</h2>
              <MuscleFigure rows={muscles} />
              <MuscleBars rows={muscles} />
              <p className="muted note">Weighted sets: a working set counts 1 for each main muscle and half for each helping muscle.</p>
            </div>
          )}

          {data.blocks.map((b) => (
            <section className="card exercise" key={b.exerciseId}>
              <button className="ex-title" onClick={() => push({ type: 'exercise', id: b.exerciseId })}>
                {b.name} <span aria-hidden>›</span>
              </button>
              <div className={`table session-table${b.sets.some((r) => r.peak != null) ? ' with-hr' : ''}`}>
                <div className="table-row head">
                  <span>Set</span>
                  <span>{b.loadType === 'assisted' ? 'Assist' : 'Weight'}</span>
                  <span>Reps</span>
                  {b.sets.some((r) => r.peak != null) && <span>Peak bpm</span>}
                </div>
                {b.sets.map((r, i) => (
                  <div className="table-row" key={r.setNo}>
                    <span>{r.warmup ? 'W' : i + 1}</span>
                    <span>{r.weight === null ? '–' : b.dumbbellPair ? `${num(r.weight)} (2×${num(r.weight / 2)})` : num(r.weight)}</span>
                    <span>{r.reps}</span>
                    {b.sets.some((x) => x.peak != null) && (
                      <span aria-label={r.peak == null ? 'no heart rate' : `peak ${r.peak} bpm${r.drop != null ? `, fell ${r.drop} in the rest` : ''}`}>
                        {r.peak ?? '–'}
                        {r.drop != null && <small className="muted"> ↓{r.drop}</small>}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {b.note && <p className="muted note">“{b.note}”</p>}
            </section>
          ))}
        </>
      )}
    </Page>
  )
}
