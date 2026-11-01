import { useEffect, useState } from 'react'
import { Page } from '../components/Page'
import { supabase } from '../lib/supabase'
import { useNav } from '../lib/nav'
import { formatDate, num } from '../lib/format'

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

export type Session = { id: string; title: string; started_at: string; ended_at: string | null; notes: string | null }

export type Block = {
  exerciseId: string
  name: string
  dumbbellPair: boolean
  loadType: string
  first: string
  sets: { setNo: number; weight: number | null; reps: string; warmup: boolean }[]
  note?: string
}

export type Loaded = { session: Session; blocks: Block[]; sets: number; volume: number }

export async function loadSession(id: string): Promise<Loaded> {
  const [s, sets, notes] = await Promise.all([
    supabase.from('sessions').select('id, title, started_at, ended_at, notes').eq('id', id).single(),
    supabase
      .from('sets')
      .select('exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at, exercises(name, dumbbell_pair, load_type)')
      .eq('session_id', id)
      .is('deleted_at', null),
    supabase.from('session_exercise_notes').select('exercise_id, note').eq('session_id', id).is('deleted_at', null),
  ])
  for (const r of [s, sets, notes]) if (r.error) throw r.error

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
          volume += (sorted[0].weight_kg ?? 0) * lowest
        }
        return { setNo, weight: sorted[0].weight_kg, reps: sorted.map((r) => r.reps ?? '–').join(' / '), warmup }
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
  return { session: s.data as Session, blocks, sets: setCount, volume }
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
      {!data && !error && <p className="muted">Loading…</p>}
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
          {s.notes && <div className="card">{s.notes}</div>}

          {data.blocks.map((b) => (
            <section className="card exercise" key={b.exerciseId}>
              <button className="ex-title" onClick={() => push({ type: 'exercise', id: b.exerciseId })}>
                {b.name} <span aria-hidden>›</span>
              </button>
              <div className="table session-table">
                <div className="table-row head">
                  <span>Set</span>
                  <span>{b.loadType === 'assisted' ? 'Assist' : 'Weight'}</span>
                  <span>Reps</span>
                </div>
                {b.sets.map((r, i) => (
                  <div className="table-row" key={r.setNo}>
                    <span>{r.warmup ? 'W' : i + 1}</span>
                    <span>{r.weight === null ? '–' : b.dumbbellPair ? `${num(r.weight)} (2×${num(r.weight / 2)})` : num(r.weight)}</span>
                    <span>{r.reps}</span>
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
