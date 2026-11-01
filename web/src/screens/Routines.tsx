import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { fetchWorkoutPlan } from '../lib/workoutPlan'

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
  const [routines, setRoutines] = useState<RoutineCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const inProgress = useLiveQuery(() => db.workouts.filter((w) => !w.endedAt).toArray(), [])

  async function start(r: RoutineCard) {
    setStarting(r.id)
    setError(null)
    try {
      const plan = await fetchWorkoutPlan(r.id)
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

  useEffect(() => {
    loadRoutines()
      .then(setRoutines)
      .catch((e) => setError(e.message ?? String(e)))
  }, [])

  return (
    <>
      <h1>Routines</h1>
      {error && <div className="card error">Could not load routines: {error}</div>}
      {!routines && !error && <p className="muted">Loading…</p>}
      {routines?.map((r) => {
        const active = inProgress?.find((w) => w.routineId === r.id)
        return (
        <div className="card routine" key={r.id}>
          <div className="routine-title">{r.name}</div>
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
