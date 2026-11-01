import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'

type SessionRow = { id: string; title: string; started_at: string; ended_at: string | null; set_count: number }

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

const PAGE = 30
const num = (n: number | null) => (n === null ? '' : String(Number(n.toFixed(2))))

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

function minutes(a: string, b: string | null) {
  if (!b) return null
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m > 0 && m < 600 ? m : null
}

/** One line per exercise: sets in order, e.g. "44×6 · 44×6 · 44×4", left/right as "7.5×11/10". */
function summarise(sets: SetRow[]) {
  const byExercise = new Map<string, { name: string; first: string; sets: SetRow[] }>()
  for (const s of sets) {
    const e = byExercise.get(s.exercise_id) ?? { name: s.exercises.name, first: s.logged_at, sets: [] }
    e.sets.push(s)
    if (s.logged_at < e.first) e.first = s.logged_at
    byExercise.set(s.exercise_id, e)
  }
  return [...byExercise.values()]
    .sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name))
    .map((e) => {
      const bySetNo = new Map<number, SetRow[]>()
      for (const s of e.sets) bySetNo.set(s.set_no, [...(bySetNo.get(s.set_no) ?? []), s])
      const parts = [...bySetNo.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, rows]) => {
          const w = rows[0].weight_kg
          const reps = rows.length > 1 ? rows.sort((x, y) => (x.side ?? '').localeCompare(y.side ?? '')).map((r) => r.reps ?? '–').join('/') : (rows[0].reps ?? '–')
          return `${rows[0].is_warmup ? 'W ' : ''}${w === null ? '' : num(w) + '×'}${reps}`
        })
      return { name: e.name, text: parts.join(' · ') }
    })
}

function SessionDetail({ id }: { id: string }) {
  const [state, setState] = useState<{ lines: { name: string; text: string; note?: string }[] } | string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase
        .from('sets')
        .select('exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at, exercises(name, dumbbell_pair, load_type)')
        .eq('session_id', id)
        .is('deleted_at', null),
      supabase.from('session_exercise_notes').select('exercise_id, note, exercises(name)').eq('session_id', id).is('deleted_at', null),
    ]).then(([sets, notes]) => {
      if (cancelled) return
      if (sets.error) return setState(sets.error.message)
      const lines: { name: string; text: string; note?: string }[] = summarise((sets.data ?? []) as unknown as SetRow[])
      const noteByName = new Map(
        ((notes.data ?? []) as unknown as { note: string; exercises: { name: string } }[]).map((n) => [n.exercises.name, n.note]),
      )
      setState({ lines: lines.map((l) => ({ ...l, note: noteByName.get(l.name) })) })
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (state === null) return <p className="muted">Loading…</p>
  if (typeof state === 'string') return <p className="error">Could not load: {state}</p>
  return (
    <div className="detail">
      {state.lines.map((l) => (
        <div key={l.name} className="detail-line">
          <strong>{l.name}</strong>
          <div>{l.text}</div>
          {l.note && <div className="muted note">“{l.note}”</div>}
        </div>
      ))}
    </div>
  )
}

export default function History() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const waiting = useLiveQuery(() => db.workouts.filter((w) => !!w.endedAt && !w.syncedAt).toArray(), [])

  const loadPage = useCallback(async (from: number) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, started_at, ended_at, sets(count)')
      .is('deleted_at', null)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .range(from, from + PAGE - 1)
    setLoading(false)
    if (error) {
      const saved = localStorage.getItem('gl_history')
      if (saved && from === 0) setSessions(JSON.parse(saved) as SessionRow[])
      setOffline(true)
      setMore(false)
      return
    }
    setOffline(false)
    const rows = (data ?? []).map((s) => ({
      id: s.id as string,
      title: s.title as string,
      started_at: s.started_at as string,
      ended_at: s.ended_at as string | null,
      set_count: (s.sets as unknown as { count: number }[])[0]?.count ?? 0,
    }))
    setMore(rows.length === PAGE)
    setSessions((prev) => {
      const next = from === 0 ? rows : [...prev, ...rows]
      if (from === 0) localStorage.setItem('gl_history', JSON.stringify(next))
      return next
    })
  }, [])

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  const waitingIds = new Set((waiting ?? []).map((w) => w.id))

  return (
    <>
      <h1>History</h1>
      {offline && <p className="muted">No signal: showing the last list that was loaded.</p>}

      {waiting?.map((w) => (
        <div className="card" key={w.id}>
          <div className="routine-title">{w.title}</div>
          <div className="muted">{formatDate(w.startedAt)}</div>
          <span className="badge">waiting to upload</span>
        </div>
      ))}

      {sessions
        .filter((s) => !waitingIds.has(s.id))
        .map((s) => {
          const mins = minutes(s.started_at, s.ended_at)
          return (
            <div className="card session" key={s.id}>
              <button className="session-head" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                <span className="routine-title">{s.title}</span>
                <span className="muted">
                  {formatDate(s.started_at)} · {s.set_count} sets{mins ? ` · ${mins} min` : ''}
                </span>
              </button>
              {open === s.id && <SessionDetail id={s.id} />}
            </div>
          )
        })}

      {more && (
        <button className="primary" disabled={loading} onClick={() => loadPage(sessions.length)}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      {!more && sessions.length === 0 && !loading && <p className="muted">No sessions yet.</p>}

      <button className="link" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </>
  )
}
