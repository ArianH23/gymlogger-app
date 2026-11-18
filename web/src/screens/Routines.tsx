import { ListSkeleton } from '../components/Skeleton'
import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { prefetchPlans, startEmptyWorkout, startRoutineWorkout } from '../lib/workoutPlan'
import { discardWorkout, reopenWorkout, syncPending } from '../lib/sync'
import { useNav } from '../lib/nav'
import { daysAgo } from '../lib/format'
import { latestCheckinDay } from '../lib/checkins'
import PlanWithClaude from '../components/PlanWithClaude'
import StreakStats from '../components/StreakStats'

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
  const waitingList = useLiveQuery(() => db.workouts.filter((w) => !!w.endedAt && !w.syncedAt).toArray(), [])
  const waiting = waitingList?.length ?? 0
  const refused = (waitingList ?? []).filter((w) => !!w.syncError) // the server refused something in these: they wait for you, the others upload by themselves
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

  /** Puts a refused workout back in progress, to correct it and finish it again. */
  async function fix(id: string) {
    if (await reopenWorkout(id)) onOpen(id)
  }

  async function throwAway(id: string, title: string) {
    if (window.confirm(`Discard “${title}” and everything logged in it?`)) await discardWorkout(id)
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
  const load = useCallback(
    () =>
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
        }),
    [],
  )
  useEffect(() => {
    void load()
    window.addEventListener('online', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      window.removeEventListener('online', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [load])

  const current = inProgress?.[0] // the one open workout, if any: nothing else can be started meanwhile

  return (
    <>
      <div className="title-row">
        <h1>Routines</h1>
        <button className="chip on" onClick={() => push({ type: 'routineForm' })}>
          + New
        </button>
      </div>
      <StreakStats />
      {!!waiting && (
        <div className="card waiting">
          <strong>
            {waiting} {waiting === 1 ? 'workout' : 'workouts'} waiting to upload
          </strong>
          <p className="muted">
            {refused.length === 0
              ? 'Saved on this phone. It uploads by itself when there is signal.'
              : `Saved on this phone. ${refused.length === 1 ? 'One of them was' : `${refused.length} of them were`} refused by the server, so nothing will fix ${refused.length === 1 ? 'it' : 'them'} by waiting. The others upload by themselves.`}
          </p>
          {refused.map((w) => (
            <div className="stuck" key={w.id}>
              <div className="routine-title">{w.title}</div>
              <p className="error">The server refused it: {w.syncError}</p>
              <div className="card-actions">
                <button className="link" disabled={!!current} onClick={() => fix(w.id)}>
                  Fix it
                </button>
                <button className="link danger" onClick={() => throwAway(w.id, w.title)}>
                  Discard
                </button>
              </div>
              {current && <p className="muted note">Finish or discard the workout in progress first.</p>}
            </div>
          ))}
          {uploadError && refused.length === 0 && <p className="error">{uploadError}</p>}
          <button className="primary" disabled={retrying} onClick={retry}>
            {retrying ? 'Uploading…' : 'Retry now'}
          </button>
        </div>
      )}
      {checkinDue && (
        <button className="card checkin-due" onClick={() => push({ type: 'checkinForm' })}>
          <strong>Weekly check-in due</strong>
          <span className="muted">
            {checkinDue.last ? `Last one ${daysAgo(`${checkinDue.last}T12:00:00`)}.` : 'No check-in yet.'} It helps your plans.
          </span>
        </button>
      )}
      {error && <div className="card error">Could not load routines: {error}</div>}
      {!routines && !error && <ListSkeleton rows={3} button />}
      {routines?.map((r) => {
        const active = inProgress?.find((w) => w.routineId === r.id)
        const blocked = !!current && !active // another workout is open
        return (
          <div className={`card routine${r.isNext ? ' next' : ''}`} key={r.id}>
            {r.isNext && <div className="eyebrow">Next up</div>}
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
              {r.plan && <span className={`badge ${r.plan}`}>{r.plan === 'claude' ? 'Claude plan ready' : 'Auto plan ready'}</span>}
            </div>
            <button className="primary start" disabled={starting !== null || blocked} onClick={() => (active ? onOpen(active.id) : start(r))}>
              {starting === r.id ? 'Loading…' : active ? 'Resume workout' : blocked ? `${current?.title} in progress` : 'Start workout'}
            </button>
            <PlanWithClaude routineId={r.id} routineName={r.name} onArrived={() => void load()} />
          </div>
        )
      })}
      {routines && (
        <button className="outline quiet" onClick={() => (current ? onOpen(current.id) : startEmpty())}>
          {current ? `Resume ${current.title}` : '+ Start empty workout'}
        </button>
      )}
    </>
  )
}
