import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type LoggedSet, type PlanExercise, type PlanSet, type Workout } from '../lib/db'
import RestTimer, { restSeconds, type Rest } from '../components/RestTimer'
import { syncPending } from '../lib/sync'
import { useNav } from '../lib/nav'

type Side = 'L' | 'R' | null
type Draft = { weight: string; reps: string }

const rowKey = (exerciseId: string, setNo: number, side: Side) => `${exerciseId}|${setNo}|${side ?? ''}`
const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(Number(n.toFixed(2))))

/** "24 kg (2×12)" for dumbbell pairs, "40 kg" otherwise. */
function kgText(weight: number | null, ex: PlanExercise) {
  if (weight === null) return 'bodyweight'
  if (ex.loadType === 'assisted') return `${num(weight)} kg assist`
  return ex.dumbbellPair ? `${num(weight)} kg (2×${num(weight / 2)})` : `${num(weight)} kg`
}

function targetText(set: PlanSet | undefined, ex: PlanExercise) {
  if (!set) return ''
  const reps =
    set.repsMin === null ? '' : set.repsMax === null || set.repsMax === set.repsMin ? `${set.repsMin}` : `${set.repsMin}-${set.repsMax}`
  const weight = set.weightKg === null ? '' : kgText(set.weightKg, ex)
  return [weight, reps && `× ${reps}`].filter(Boolean).join(' ')
}

function lastText(ex: PlanExercise, setNo: number, side: Side) {
  const last = ex.last.find((l) => l.setNo === setNo) ?? ex.last[ex.last.length - 1]
  if (!last) return '–'
  const reps = side === 'L' ? last.repsL : side === 'R' ? last.repsR : last.repsResult
  if (reps === null) return '–'
  return `${last.weightKg === null ? '' : num(last.weightKg) + '×'}${reps}`
}

function defaultDraft(ex: PlanExercise, planSet: PlanSet | undefined): Draft {
  const lastWeight = [...ex.sets].reverse().find((s) => s.weightKg !== null)?.weightKg ?? ex.last[0]?.weightKg ?? null
  return { weight: num(planSet?.weightKg ?? lastWeight), reps: num(planSet?.repsMin) }
}

type RowProps = {
  ex: PlanExercise
  setNo: number
  side: Side
  planSet: PlanSet | undefined
  logged: LoggedSet | undefined
  draft: Draft
  onDraft: (d: Draft) => void
  onToggle: () => void
}

function SetRow({ ex, setNo, side, logged, draft, onDraft, onToggle }: RowProps) {
  const label = side ?? String(setNo)
  const weight = logged ? num(logged.weightKg) : draft.weight
  const reps = logged ? String(logged.reps) : draft.reps
  return (
    <div className={`set-row${logged ? ' done' : ''}`}>
      <span className="set-label">{label}</span>
      <span className="set-last">{lastText(ex, setNo, side)}</span>
      <input
        inputMode="decimal"
        aria-label="Weight in kg"
        value={weight}
        readOnly={!!logged}
        onFocus={(e) => e.target.select()}
        placeholder={ex.loadType === 'bodyweight' ? 'BW' : 'kg'}
        onChange={(e) => onDraft({ ...draft, weight: e.target.value })}
      />
      <input
        inputMode="numeric"
        aria-label="Reps"
        value={reps}
        readOnly={!!logged}
        onFocus={(e) => e.target.select()}
        placeholder="reps"
        onChange={(e) => onDraft({ ...draft, reps: e.target.value })}
      />
      <button className="check" aria-label={logged ? 'Undo set' : 'Log set'} onClick={onToggle}>
        ✓
      </button>
    </div>
  )
}

export default function ActiveWorkout({ workoutId, onExit }: { workoutId: string; onExit: () => void }) {
  const { push } = useNav()
  const workout = useLiveQuery(() => db.workouts.get(workoutId), [workoutId])
  const logged = useLiveQuery(() => db.sets.where('sessionId').equals(workoutId).toArray(), [workoutId])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [rest, setRest] = useState<Rest | null>(null)

  if (!workout || !logged) return null
  const loggedByKey = new Map(logged.map((s) => [rowKey(s.exerciseId, s.setNo, s.side), s]))

  async function toggle(ex: PlanExercise, setNo: number, side: Side, draft: Draft) {
    const key = rowKey(ex.exerciseId, setNo, side)
    const existing = loggedByKey.get(key)
    if (existing) {
      await db.sets.delete(existing.id)
      return
    }
    const reps = parseInt(draft.reps, 10)
    if (Number.isNaN(reps)) return // nothing to log without reps
    const weight = parseFloat(draft.weight.replace(',', '.'))
    const otherSide: Side = side === 'L' ? 'R' : side === 'R' ? 'L' : null
    const setComplete = side === null || loggedByKey.has(rowKey(ex.exerciseId, setNo, otherSide))
    if (setComplete) {
      // Rest starts once the whole set is done (for left/right: after both sides).
      const planSet = ex.sets.find((s) => s.setNo === setNo) ?? ex.sets[ex.sets.length - 1]
      setRest({ endsAt: Date.now() + restSeconds(planSet?.repsMax) * 1000 })
    }
    await db.sets.add({
      id: crypto.randomUUID(),
      sessionId: workoutId,
      exerciseId: ex.exerciseId,
      setNo,
      side,
      weightKg: Number.isNaN(weight) ? null : weight,
      reps,
      isWarmup: false,
      loggedAt: new Date().toISOString(),
      synced: 0,
    })
  }

  async function addSet(w: Workout, exerciseId: string) {
    await db.workouts.update(w.id, { extraSets: { ...w.extraSets, [exerciseId]: (w.extraSets[exerciseId] ?? 0) + 1 } })
  }

  async function discard(ask = true) {
    if (ask && !window.confirm('Discard this workout and everything logged in it?')) return
    await db.sets.where('sessionId').equals(workoutId).delete()
    await db.workouts.delete(workoutId)
    onExit()
  }

  async function finish() {
    if (logged!.length === 0) {
      if (window.confirm('No sets logged. Discard this workout?')) await discard(false)
      return
    }
    await db.workouts.update(workoutId, { endedAt: new Date().toISOString() })
    onExit()
    void syncPending() // uploads in the background; retried automatically if there is no signal
  }

  return (
    <div className="app">
      <main className="screen workout">
        <div className="workout-bar">
          <button className="link" onClick={onExit}>
            ‹ Back
          </button>
          <button className="finish" onClick={finish}>
            Finish
          </button>
        </div>
        <h1>{workout.title}</h1>
        <p className="muted">
          Started {new Date(workout.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
          {logged.length} {logged.length === 1 ? 'set' : 'sets'} logged
        </p>

        {workout.plan.map((ex) => {
          const extra = workout.extraSets[ex.exerciseId] ?? 0
          const planned = ex.sets.map((s) => s.setNo)
          const next = Math.max(0, ...planned) + 1
          const setNos = [...planned, ...Array.from({ length: extra }, (_, i) => next + i)]
          const sides: Side[] = ex.unilateral ? ['L', 'R'] : [null]
          return (
            <section className="card exercise" key={ex.exerciseId}>
              <button className="ex-title" onClick={() => push({ type: 'exercise', id: ex.exerciseId })}>
                {ex.name} <span aria-hidden>›</span>
              </button>
              {setNos.map((setNo) => {
                const planSet = ex.sets.find((s) => s.setNo === setNo)
                return (
                  <div className="set-group" key={setNo}>
                    {planSet && (
                      <div className="set-target">
                        Set {setNo} · plan {targetText(planSet, ex) || 'no target'}
                        {planSet.note && <div className="muted note">{planSet.note}</div>}
                      </div>
                    )}
                    {!planSet && <div className="set-target">Set {setNo} · extra</div>}
                    {sides.map((side) => {
                      const key = rowKey(ex.exerciseId, setNo, side)
                      const draft = drafts[key] ?? defaultDraft(ex, planSet)
                      return (
                        <SetRow
                          key={key}
                          ex={ex}
                          setNo={setNo}
                          side={side}
                          planSet={planSet}
                          logged={loggedByKey.get(key)}
                          draft={draft}
                          onDraft={(d) => setDrafts((prev) => ({ ...prev, [key]: d }))}
                          onToggle={() => toggle(ex, setNo, side, draft)}
                        />
                      )
                    })}
                  </div>
                )
              })}
              <button className="link" onClick={() => addSet(workout, ex.exerciseId)}>
                + Set
              </button>
            </section>
          )
        })}

        <button className="link danger" onClick={() => discard()}>
          Discard workout
        </button>
      </main>
      {rest && <RestTimer rest={rest} onChange={setRest} />}
    </div>
  )
}
