import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { getWorkoutPlan, prefetchPlans } from '../lib/workoutPlan'
import { syncPending } from '../lib/sync'
import { useNav } from '../lib/nav'

type RoutineCard = {
  id: string
  name: string
  exerciseCount: number
  lastSession: string | null
  plan: 'claude' | 'rules' | null
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

async function loadRoutines(): Promise<RoutineCard[]> {
  const [routines, sessions, plans] = await Promise.all([
    supabase
      .from('routines')
      .select('id, name, routine_exercises(count)')
      .is('deleted_at', null)
      .order('position'),
    supabase
      .from('sessions')
      .select('routine_id, started_at')
      .not('routine_id', 'is', null)
      .is('deleted_at', null)
      .order('started_at', { ascending: false })
      .limit(200),
    supabase.from('current_plan').select('routine_id, created_by'),
  ])
  for (const r of [routines, sessions, plans]) if (r.error) throw r.error

  const lastByRoutine = new Map<string, string>()
  for (const s of sessions.data ?? []) {
    if (s.routine_id && !lastByRoutine.has(s.routine_id)) lastByRoutine.set(s.routine_id, s.started_at)
  }
  const planByRoutine = new Map((plans.data ?? []).map((p) => [p.routine_id, p.created_by as 'claude' | 'rules']))

  return (routines.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    exerciseCount: r.routine_exercises[0]?.count ?? 0,
    lastSession: lastByRoutine.get(r.id) ?? null,
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

  async function retry() {
    setRetrying(true)
    setUploadError(await syncPending())
    setRetrying(false)
  }

  async function startEmpty() {
    const hour = new Date().getHours()
    const id = crypto.randomUUID()
    await db.workouts.add({
      id,
      routineId: null,
      title: hour < 12 ? 'Morning workout' : hour < 18 ? 'Afternoon workout' : 'Evening workout',
      startedAt: new Date().toISOString(),
      endedAt: null,
      plan: [],
      extraSets: {},
    })
    onOpen(id)
  }

  async function start(r: RoutineCard) {
    setStarting(r.id)
    setError(null)
    try {
      const plan = await getWorkoutPlan(r.id)
      const id = crypto.randomUUID()
      await db.workouts.add({
        id,
        routineId: r.id,
        title: r.name,
        startedAt: new Date().toISOString(),
        endedAt: null,
        plan,
        extraSets: {},
      })
      onOpen(id)
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
      {(() => {
        const emptyOpen = inProgress?.find((w) => w.routineId === null)
        return (
          <button className="outline" onClick={() => (emptyOpen ? onOpen(emptyOpen.id) : startEmpty())}>
            {emptyOpen ? `Resume ${emptyOpen.title.toLowerCase()}` : '+ Start empty workout'}
          </button>
        )
      })()}
      {error && <div className="card error">Could not load routines: {error}</div>}
      {!routines && !error && <p className="muted">Loading…</p>}
      {routines?.map((r) => {
        const active = inProgress?.find((w) => w.routineId === r.id)
        return (
        <div className="card routine" key={r.id}>
          <div className="routine-head">
            <div className="routine-title">{r.name}</div>
            <button className="link edit-link" onClick={() => push({ type: 'routineForm', id: r.id })}>
              Edit
            </button>
          </div>
          <div className="muted">
            {r.exerciseCount} exercises · {r.lastSession ? `last ${formatDay(r.lastSession)}` : 'not done yet'}
          </div>
          {r.plan && (
            <span className={`badge ${r.plan}`}>{r.plan === 'claude' ? 'Claude plan ready' : 'Auto plan ready'}</span>
          )}
          <button className="primary start" disabled={starting !== null} onClick={() => (active ? onOpen(active.id) : start(r))}>
            {starting === r.id ? 'Loading…' : active ? 'Resume workout' : 'Start workout'}
          </button>
        </div>
        )
      })}
    </>
  )
}
