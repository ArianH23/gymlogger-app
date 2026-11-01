import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { prefetchPlans, startEmptyWorkout, startRoutineWorkout } from '../lib/workoutPlan'
import { syncPending } from '../lib/sync'
import { useNav } from '../lib/nav'
import { daysAgo } from '../lib/format'
import { latestCheckinDay } from '../lib/checkins'

type RoutineCard = {
  id: string
  name: string
  exerciseCount: number
  lastSession: string | null
  isNext: boolean
  plan: 'claude' | 'rules' | null
}

async function loadRoutines(): Promise<RoutineCard[]> {
  const [routines, status, plans] = await Promise.all([
    supabase.from('routines').select('id, name, routine_exercises(count)').is('deleted_at', null).order('position'),
    // routine_status says when each routine was last done and which one is next (the one done longest ago)
    supabase.from('routine_status').select('routine_id, last_started_at, is_next'),
    supabase.from('current_plan').select('routine_id, created_by'),
  ])
  for (const r of [routines, status, plans]) if (r.error) throw r.error

  const statusBy = new Map((status.data ?? []).map((s) => [s.routine_id as string, s]))
  const planByRoutine = new Map((plans.data ?? []).map((p) => [p.routine_id, p.created_by as 'claude' | 'rules']))

  return (routines.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    exerciseCount: r.routine_exercises[0]?.count ?? 0,
    lastSession: (statusBy.get(r.id)?.last_started_at as string | null) ?? null,
    isNext: !!statusBy.get(r.id)?.is_next,
    plan: planByRoutine.get(r.id) ?? null,
  }))
}

export default function Routines({ onOpen }: { onOpen: (workoutId: string) => void }) {
  const { push } = useNav()
  const [routines, setRoutines] = useState<RoutineCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const inProgress = useLiveQuery(() => db.workouts.filter((w) => !w.endedAt).toArray(), [])
  const waiting = useLiveQuery(() => db.workouts.filter((w) => !!w.endedAt && !w.syncedAt).count(), [])
  const [retrying, setRetrying] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // null = unknown (no signal): the reminder only shows when we know a check-in is due
  const [checkinDue, setCheckinDue] = useState<{ last: string | null } | null>(null)

  useEffect(() => {
    latestCheckinDay().then((day) => {
      const days = day ? Math.round((Date.now() - new Date(`${day}T12:00:00`).getTime()) / 86400000) : Infinity
      setCheckinDue(days >= 7 ? { last: day } : null)
    })
  }, [])

  async function retry() {
    setRetrying(true)
    setUploadError(await syncPending())
    setRetrying(false)
  }

  async function startEmpty() {
    try {
      onOpen(await startEmptyWorkout())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function start(r: RoutineCard) {
    setStarting(r.id)
    setError(null)
    try {
      onOpen(await startRoutineWorkout(r.id, r.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(null)
    }
  }

  // Load the routine list (or the last copy if there is no signal) and keep every plan on the phone.
  useEffect(() => {
    const load = () =>
      loadRoutines()
        .then((list) => {
          localStorage.setItem('gl_routines', JSON.stringify(list))
          setRoutines(list)
          setError(null)
          void prefetchPlans(list.map((r) => r.id))
        })
        .catch((e) => {
          const saved = localStorage.getItem('gl_routines')
          if (saved) setRoutines(JSON.parse(saved) as RoutineCard[])
          else setError(e.message ?? String(e))
        })
    void load()
    window.addEventListener('online', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      window.removeEventListener('online', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])

  const current = inProgress?.[0] // the one open workout, if any: nothing else can be started meanwhile

  return (
    <>
      <div className="title-row">
        <h1>Routines</h1>
        <button className="chip on" onClick={() => push({ type: 'routineForm' })}>
          + New
        </button>
      </div>
      {!!waiting && (
        <div className="card waiting">
          <strong>
            {waiting} {waiting === 1 ? 'workout' : 'workouts'} waiting to upload
          </strong>
          <p className="muted">Saved on this phone. It uploads by itself when there is signal.</p>
          {uploadError && <p className="error">{uploadError}</p>}
          <button className="primary" disabled={retrying} onClick={retry}>
            {retrying ? 'Uploading…' : 'Retry now'}
          </button>
        </div>
      )}
      {checkinDue && (
        <button className="card checkin-due" onClick={() => push({ type: 'checkinForm' })}>
          <strong>Weekly check-in due</strong>
          <span className="muted">
            {checkinDue.last ? `Last one ${daysAgo(`${checkinDue.last}T12:00:00`)}.` : 'No check-in yet.'} Bodyweight, waist, sleep: it helps your plans.
          </span>
        </button>
      )}
      <button className="outline" onClick={() => (current ? onOpen(current.id) : startEmpty())}>
        {current ? `Resume ${current.title}` : '+ Start empty workout'}
      </button>
      {error && <div className="card error">Could not load routines: {error}</div>}
      {!routines && !error && <p className="muted">Loading…</p>}
      {routines?.map((r) => {
        const active = inProgress?.find((w) => w.routineId === r.id)
        const blocked = !!current && !active // another workout is open
        return (
          <div className={`card routine${r.isNext ? ' next' : ''}`} key={r.id}>
            <div className="routine-head">
              <button className="routine-open" onClick={() => push({ type: 'routine', id: r.id })}>
                <span className="routine-title">{r.name}</span>
                <span className="muted">
                  {r.exerciseCount} exercises · {r.lastSession ? `last done ${daysAgo(r.lastSession)}` : 'not done yet'}
                </span>
              </button>
              <button className="link edit-link" onClick={() => push({ type: 'routineForm', id: r.id })}>
                Edit
              </button>
            </div>
            <div className="badges">
              {r.isNext && <span className="badge next-badge">Next up</span>}
              {r.plan && <span className={`badge ${r.plan}`}>{r.plan === 'claude' ? 'Claude plan ready' : 'Auto plan ready'}</span>}
            </div>
            <button className="primary start" disabled={starting !== null || blocked} onClick={() => (active ? onOpen(active.id) : start(r))}>
              {starting === r.id ? 'Loading…' : active ? 'Resume workout' : blocked ? `${current?.title} in progress` : 'Start workout'}
            </button>
          </div>
        )
      })}
    </>
  )
}
