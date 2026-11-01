import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Page } from '../components/Page'
import { supabase } from '../lib/supabase'
import { db, type PlanExercise } from '../lib/db'
import { useNav } from '../lib/nav'
import { daysAgo, formatDate, num, targetText } from '../lib/format'
import { getWorkoutPlan, startRoutineWorkout } from '../lib/workoutPlan'
import { duration, loadSession, type Block, type Loaded } from './SessionPage'
import ScoreBadge from '../components/ScoreBadge'

type Stat = { sets: number; totalReps: number; bestWeightKg: number | null; volumeKg: number | null }

type Data = {
  name: string
  isNext: boolean
  lastStartedAt: string | null
  last: Loaded | null
  cur: Record<string, Stat> // by exercise id, last session
  prev: Record<string, Stat> // by exercise id, the session before
  prevTotals: { sets: number; volume: number } | null
  plan: PlanExercise[]
  planKind: 'claude' | 'rules' | null
  planNotes: string | null
}

async function load(id: string): Promise<Data> {
  const [status, sessions, planMeta, plan] = await Promise.all([
    supabase.from('routine_status').select('name, is_next, last_started_at').eq('routine_id', id).single(),
    supabase
      .from('sessions')
      .select('id')
      .eq('routine_id', id)
      .is('deleted_at', null)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(2),
    supabase.from('current_plan').select('created_by, notes').eq('routine_id', id).maybeSingle(),
    getWorkoutPlan(id).catch(() => [] as PlanExercise[]),
  ])
  if (status.error) throw status.error

  const ids = (sessions.data ?? []).map((s) => s.id as string)
  const byExercise = (rows: Record<string, unknown>[], sessionId: string | undefined) => {
    const out: Record<string, Stat> = {}
    for (const r of rows) {
      if (r.session_id !== sessionId) continue
      out[r.exercise_id as string] = {
        sets: Number(r.sets),
        totalReps: Number(r.total_reps),
        bestWeightKg: r.best_weight_kg as number | null,
        volumeKg: r.session_volume_kg as number | null,
      }
    }
    return out
  }

  let last: Loaded | null = null
  let cur: Record<string, Stat> = {}
  let prev: Record<string, Stat> = {}
  let prevTotals: Data['prevTotals'] = null
  if (ids.length > 0) {
    const [stats, loaded] = await Promise.all([
      supabase.from('exercise_session_stats').select('session_id, exercise_id, sets, total_reps, best_weight_kg, session_volume_kg').in('session_id', ids),
      loadSession(ids[0]),
    ])
    if (stats.error) throw stats.error
    const rows = (stats.data ?? []) as Record<string, unknown>[]
    last = loaded
    cur = byExercise(rows, ids[0])
    if (ids[1]) {
      prev = byExercise(rows, ids[1])
      const list = Object.values(prev)
      prevTotals = { sets: list.reduce((a, s) => a + s.sets, 0), volume: list.reduce((a, s) => a + (s.volumeKg ?? 0), 0) }
    }
  }

  return {
    name: status.data.name as string,
    isNext: !!status.data.is_next,
    lastStartedAt: status.data.last_started_at as string | null,
    last,
    cur,
    prev,
    prevTotals,
    plan,
    planKind: (planMeta.data?.created_by as 'claude' | 'rules' | undefined) ?? null,
    planNotes: (planMeta.data?.notes as string | null | undefined) ?? null,
  }
}

type D = { dir: 'up' | 'down' | 'same'; text: string }

/** Change between two numbers. 'up' always means better (for lower-is-better numbers a drop counts as up). */
function delta(now: number | null | undefined, before: number | null | undefined, opts: { lowerIsBetter?: boolean; percent?: boolean } = {}): D | null {
  if (now == null || before == null) return null
  const d = now - before
  if (Math.abs(d) < 0.005) return { dir: 'same', text: 'same' }
  const better = opts.lowerIsBetter ? d < 0 : d > 0
  const sign = d > 0 ? '+' : '−'
  const body = opts.percent ? (before === 0 ? '' : `${Math.round(Math.abs(d / before) * 100)}%`) : num(Math.abs(d))
  return body ? { dir: better ? 'up' : 'down', text: `${sign}${body}` } : null
}

function Delta({ d, unit = '', label }: { d: D | null; unit?: string; label: string }) {
  if (!d) return null
  return (
    <span className="delta">
      <i className={d.dir} aria-hidden>{d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '＝'}</i>
      <span className="delta-text">
        {label} {d.text}
        {d.dir === 'same' ? '' : unit}
      </span>
    </span>
  )
}

const compactSets = (b: Block) => b.sets.map((s) => `${s.warmup ? 'W ' : ''}${s.weight === null ? '' : num(s.weight) + '×'}${s.reps.replace(/ /g, '')}`).join(' · ')

export default function RoutinePage({ id }: { id: string }) {
  const { push, setOpenWorkoutId, popToRoot } = useNav()
  const [data, setData] = useState<Data | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = useLiveQuery(() => db.workouts.filter((w) => !w.endedAt).first(), []) // the one open workout, if any
  const active = current?.routineId === id ? current : undefined
  const blocked = !!current && !active // another workout is open: this one cannot be started meanwhile

  useEffect(() => {
    const key = `gl_routine_page_${id}`
    load(id)
      .then((d) => {
        setData(d)
        try {
          localStorage.setItem(key, JSON.stringify(d))
        } catch {
          // storage full: it still works online
        }
      })
      .catch((e) => {
        const saved = localStorage.getItem(key)
        if (saved) {
          setData(JSON.parse(saved) as Data)
          setOffline(true)
        } else setError(e instanceof Error ? e.message : String(e?.message ?? e))
      })
  }, [id])

  async function start() {
    if (!data) return
    setBusy(true)
    try {
      setOpenWorkoutId(active ? active.id : await startRoutineWorkout(id, data.name))
      popToRoot()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const planBy = new Map((data?.plan ?? []).map((p) => [p.exerciseId, p]))
  const lastIds = new Set((data?.last?.blocks ?? []).map((b) => b.exerciseId))
  const newInPlan = (data?.plan ?? []).filter((p) => !lastIds.has(p.exerciseId))
  const totals = data?.last
  const volDelta = delta(totals?.volume, data?.prevTotals?.volume, { percent: true })
  const setsDelta = delta(totals?.sets, data?.prevTotals?.sets)

  return (
    <Page
      title={data?.name ?? 'Routine'}
      action={
        data && (
          <button className="link edit-link" onClick={() => push({ type: 'routineForm', id })}>
            Edit
          </button>
        )
      }
    >
      {error && <div className="card error">Could not load this routine: {error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {offline && <p className="muted">No signal: showing the last copy saved on this phone.</p>}
      {data && (
        <>
          <div className="badges">
            {data.isNext && <span className="badge next-badge">Next up</span>}
            {data.planKind && <span className={`badge ${data.planKind}`}>{data.planKind === 'claude' ? 'Claude plan ready' : 'Auto plan ready'}</span>}
          </div>
          <p className="muted subtitle">
            {data.lastStartedAt ? `Last done ${formatDate(data.lastStartedAt)} · ${daysAgo(data.lastStartedAt)}` : 'Not done yet'}
          </p>
          <button className="primary" disabled={busy || blocked} onClick={start}>
            {busy ? 'Loading…' : active ? 'Resume workout' : blocked ? `${current?.title} in progress` : 'Start workout'}
          </button>

          {data.planKind === 'claude' && data.planNotes && <p className="card note-card">“{data.planNotes}”</p>}

          {totals && (
            <>
              <h2>Last session</h2>
              <ScoreBadge score={totals.score} size="large" />
              <div className="stat-row">
                <div className="stat">
                  <div className="stat-value">{duration(totals.session.started_at, totals.session.ended_at) ?? '–'}</div>
                  <div className="muted">duration</div>
                </div>
                <div className="stat">
                  <div className="stat-value">{totals.sets}</div>
                  <div className="muted">sets</div>
                  <Delta d={setsDelta} label="" />
                </div>
                <div className="stat">
                  <div className="stat-value">{totals.volume >= 10000 ? `${(totals.volume / 1000).toFixed(1)}t` : `${Math.round(totals.volume)} kg`}</div>
                  <div className="muted">volume</div>
                  <Delta d={volDelta} label="" />
                </div>
              </div>
              {data.prevTotals && <p className="muted note">Compared with the session before: ▲ better, ▼ worse.</p>}

              {totals.blocks.map((b) => {
                const cur = data.cur[b.exerciseId]
                const prev = data.prev[b.exerciseId]
                const planned = planBy.get(b.exerciseId)
                const assisted = b.loadType === 'assisted'
                const bodyweight = b.loadType === 'bodyweight'
                return (
                  <section className="card exercise" key={b.exerciseId}>
                    <button className="ex-title" onClick={() => push({ type: 'exercise', id: b.exerciseId })}>
                      {b.name} <span aria-hidden>›</span>
                    </button>
                    <div className="sets-line">{compactSets(b)}</div>
                    {prev && (
                      <div className="deltas">
                        {!bodyweight && <Delta d={delta(cur?.bestWeightKg, prev.bestWeightKg, { lowerIsBetter: assisted })} unit=" kg" label={assisted ? 'assist' : 'best'} />}
                        {!bodyweight && !assisted && <Delta d={delta(cur?.volumeKg, prev.volumeKg, { percent: true })} label="volume" />}
                        {(bodyweight || assisted) && <Delta d={delta(cur?.totalReps, prev.totalReps)} unit=" reps" label="reps" />}
                      </div>
                    )}
                    {!prev && data.prevTotals && <p className="muted note">New since the session before.</p>}
                    {planned && planned.sets.length > 0 && (
                      <div className="next-line">
                        <span className="muted">Next</span>
                        <span className="targets">
                          {planned.sets.some((s) => targetText(s, planned)) ? (
                            planned.sets.map((s) => <span key={s.setNo}>{targetText(s, planned) || '–'}</span>)
                          ) : (
                            <span>no target yet</span>
                          )}
                        </span>
                      </div>
                    )}
                    {!planned && data.plan.length > 0 && <p className="muted note">Not in the next plan.</p>}
                    {b.note && <p className="muted note">“{b.note}”</p>}
                  </section>
                )
              })}
            </>
          )}

          {!totals && <div className="card muted">Nothing logged for this routine yet.</div>}

          {newInPlan.length > 0 && (
            <>
              <h2>New in the plan</h2>
              {newInPlan.map((p) => (
                <section className="card exercise" key={p.exerciseId}>
                  <button className="ex-title" onClick={() => push({ type: 'exercise', id: p.exerciseId })}>
                    {p.name} <span aria-hidden>›</span>
                  </button>
                  <div className="next-line">
                    <span className="muted">Next</span>
                    <span className="targets">
                      {p.sets.some((s) => targetText(s, p)) ? (
                        p.sets.map((s) => <span key={s.setNo}>{targetText(s, p) || '–'}</span>)
                      ) : (
                        <span>{p.sets.length} sets, no target yet</span>
                      )}
                    </span>
                  </div>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </Page>
  )
}
