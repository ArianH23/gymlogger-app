import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type LastSet, type LoggedSet, type PlanExercise, type PlanSet, type Workout } from '../lib/db'
import RestTimer, { restSeconds, type Rest } from '../components/RestTimer'
import { discardWorkout, noteDeletedSet, scheduleSync, syncPending, touchLive } from '../lib/sync'
import { parseSetInput } from '../lib/setInput'
import { useNav } from '../lib/nav'
import { supabase } from '../lib/supabase'
import ExercisePicker from '../components/ExercisePicker'
import ReplacePanel from '../components/ReplacePanel'
import FinishSheet from '../components/FinishSheet'
import MuscleTags from '../components/MuscleTags'
import { loadExerciseMuscles, type ExerciseMuscle } from '../lib/muscles'
import { createRoutine, suggestRoutineName } from '../lib/routines'
import { loadExerciseList, type ExerciseRow } from '../lib/exerciseList'
import { num, targetText } from '../lib/format'
import { removeSetRow, visibleSetNos } from '../lib/setRows'
import { replaceInWorkout } from '../lib/replace'

type Side = 'L' | 'R' | null
type Draft = { weight: string; reps: string }

const rowKey = (exerciseId: string, setNo: number, side: Side) => `${exerciseId}|${setNo}|${side ?? ''}`
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
  const lastTap = useRef(-1000) // a double tap on the check must not log the set and straight away undo it
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
      <button
        className="check"
        aria-label={logged ? 'Undo set' : 'Log set'}
        onClick={(e) => {
          if (e.timeStamp - lastTap.current < 500) return
          lastTap.current = e.timeStamp
          onToggle()
        }}
      >
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
  const [picking, setPicking] = useState(false)
  const [replacing, setReplacing] = useState<string | null>(null) // the exercise whose replacements are shown under it
  const [replaceSearch, setReplaceSearch] = useState<string | null>(null) // the exercise being replaced from the full list
  const [askFinish, setAskFinish] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null) // why the last set was not logged
  const [muscles, setMuscles] = useState<Record<string, ExerciseMuscle[]>>({})

  // which muscles each exercise works: a bonus, kept on the phone so it shows offline too
  useEffect(() => {
    loadExerciseMuscles()
      .then(setMuscles)
      .catch(() => undefined)
  }, [])

  // If this workout was finished or thrown away on another device, leave it.
  const seen = useRef(false)
  useEffect(() => {
    if (workout) seen.current = true
    if ((workout && workout.endedAt) || (!workout && seen.current)) onExit()
  }, [workout, onExit])

  if (!workout || !logged) return null
  const loggedByKey = new Map(logged.map((s) => [rowKey(s.exerciseId, s.setNo, s.side), s]))

  async function toggle(ex: PlanExercise, setNo: number, side: Side, draft: Draft) {
    const key = rowKey(ex.exerciseId, setNo, side)
    const existing = loggedByKey.get(key)
    if (existing) {
      await noteDeletedSet(workoutId, existing) // so the server and the other devices drop it too
      await db.sets.delete(existing.id)
      scheduleSync()
      return
    }
    const input = parseSetInput(draft.weight, draft.reps)
    if (!input.ok) {
      setInputError(`Set ${setNo}${side ? ` ${side}` : ''}: ${input.message}`) // the server would refuse it, and then the whole workout could not upload
      return
    }
    setInputError(null)
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
      weightKg: input.weightKg,
      reps: input.reps,
      isWarmup: false,
      loggedAt: new Date().toISOString(),
      synced: 0,
    })
    scheduleSync() // shared with the other devices within a moment (and saved here already)
  }

  async function addSet(w: Workout, exerciseId: string) {
    await db.workouts.update(w.id, { extraSets: { ...w.extraSets, [exerciseId]: (w.extraSets[exerciseId] ?? 0) + 1 } })
    await touchLive(w.id)
  }

  /** Takes an empty set off the list (the same as on the watch). A set with something logged has to be undone first. */
  async function removeSet(w: Workout, ex: PlanExercise, setNo: number) {
    const after = removeSetRow(w, ex.exerciseId, ex.sets.map((s) => s.setNo), setNo)
    await db.workouts.update(w.id, { extraSets: after.extraSets, removedSets: after.removedSets })
    await touchLive(w.id)
  }

  /** An exercise for the plan. Its sets start from what you did last time, when that is known (and are 3 when `count` is not given). */
  async function planExercise(row: ExerciseRow, count?: number): Promise<PlanExercise> {
    let last: LastSet[] = []
    try {
      const { data } = await supabase
        .from('last_performance')
        .select('set_no, weight_kg, reps_l, reps_r, reps_result')
        .eq('exercise_id', row.id)
        .order('set_no')
      last = (data ?? []).map((r) => ({ setNo: r.set_no, weightKg: r.weight_kg, repsL: r.reps_l, repsR: r.reps_r, repsResult: r.reps_result }))
    } catch {
      // no signal: the exercise is added without last-time numbers
    }
    const n = count ?? Math.max(last.length, 3)
    const sets: PlanSet[] = Array.from({ length: n }, (_, i) => {
      const l = last[i] ?? last[last.length - 1]
      return { setNo: i + 1, weightKg: l?.weightKg ?? null, repsMin: l?.repsResult ?? null, repsMax: null, note: i === 0 && l ? 'Same as last time' : null }
    })
    return {
      exerciseId: row.id,
      name: row.name,
      loadType: row.loadType,
      unilateral: row.unilateral,
      dumbbellPair: row.dumbbellPair,
      sets,
      last,
    }
  }

  /** Adds an exercise that isn't in the plan. */
  async function addExercise(row: ExerciseRow) {
    setPicking(false)
    const ex = await planExercise(row)
    await db.workouts.update(workoutId, { plan: [...workout!.plan, ex] })
    await touchLive(workoutId)
  }

  /** Puts another exercise where this one is, with the same number of sets. Only while nothing is logged for it. */
  async function replaceExercise(w: Workout, old: PlanExercise, row: ExerciseRow) {
    setReplacing(null)
    setReplaceSearch(null)
    if (logged!.some((s) => s.exerciseId === old.exerciseId)) return
    const count = Math.max(1, visibleSetNos(w, old.exerciseId, old.sets.map((s) => s.setNo)).length)
    const next = await planExercise(row, count)
    await db.workouts.update(w.id, replaceInWorkout(w, old.exerciseId, next))
    await touchLive(w.id)
  }

  /** A suggestion has only an id and a name: the rest of the exercise comes from the list kept on the phone. */
  async function replaceWithSuggestion(w: Workout, old: PlanExercise, exerciseId: string) {
    const row = (await loadExerciseList())?.rows.find((r) => r.id === exerciseId)
    if (row) await replaceExercise(w, old, row)
    else setReplaceSearch(old.exerciseId) // not in the saved list: choose it from the full list instead
  }

  /** Only for an exercise you haven't logged anything for yet (to swap it for another). */
  async function removeExercise(w: Workout, exerciseId: string) {
    const { [exerciseId]: _dropped, ...extraSets } = w.extraSets
    await db.workouts.update(w.id, { plan: w.plan.filter((e) => e.exerciseId !== exerciseId), extraSets })
    await touchLive(w.id)
  }

  /** Machine taken: puts the exercise's backup in its place. The planned one becomes the backup, so the same tap swaps it back. */
  async function swapToBackup(w: Workout, ex: PlanExercise) {
    if (!ex.backup) return
    const { [ex.exerciseId]: _dropped, ...extraSets } = w.extraSets
    const swapped: PlanExercise = { ...ex.backup, backup: { ...ex, backup: null, swapped: false }, swapped: !ex.swapped }
    await db.workouts.update(w.id, { plan: w.plan.map((e) => (e.exerciseId === ex.exerciseId ? swapped : e)), extraSets })
    await touchLive(w.id)
  }

  async function discard(ask = true) {
    if (ask && !window.confirm('Discard this workout and everything logged in it?')) return
    await discardWorkout(workoutId)
    onExit()
  }

  async function completeFinish(routineId: string | null, feeling: number | null) {
    await db.workouts.update(workoutId, { endedAt: new Date().toISOString(), routineId, feeling })
    onExit()
    void syncPending() // uploads in the background; retried automatically if there is no signal
  }

  async function finish() {
    if (logged!.length === 0) {
      if (window.confirm('No sets logged. Discard this workout?')) await discard(false)
      return
    }
    setAskFinish(true) // one sheet: the optional feeling and, for an empty workout, saving it as a routine
  }

  /** Exercises that have logged sets, in workout order, with how many sets you did of each. */
  function routineItems() {
    return workout!.plan
      .map((ex) => ({
        exerciseId: ex.exerciseId,
        targetSets: new Set(logged!.filter((s) => s.exerciseId === ex.exerciseId).map((s) => s.setNo)).size,
      }))
      .filter((it) => it.targetSets > 0)
  }

  async function saveAsRoutine(name: string, feeling: number | null) {
    const id = await createRoutine(name, routineItems())
    setAskFinish(false)
    await completeFinish(id, feeling)
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
        {inputError && (
          <p className="error" role="alert">
            {inputError}
          </p>
        )}
        <p className="muted">
          Started {new Date(workout.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
          {logged.length} {logged.length === 1 ? 'set' : 'sets'} logged
        </p>

        {workout.plan.length === 0 && (
          <div className="card">
            <strong>Empty workout</strong>
            <p className="muted">Add the first exercise to start logging.</p>
          </div>
        )}

        {workout.plan.map((ex) => {
          const setNos = visibleSetNos(workout, ex.exerciseId, ex.sets.map((s) => s.setNo)) // without the ones taken off the list (here or on the watch)
          const sides: Side[] = ex.unilateral ? ['L', 'R'] : [null]
          return (
            <section className="card exercise" key={ex.exerciseId}>
              <button className="ex-title" onClick={() => push({ type: 'exercise', id: ex.exerciseId })}>
                {ex.name} <span aria-hidden>›</span>
              </button>
              <MuscleTags muscles={muscles[ex.exerciseId]} />
              {setNos.map((setNo) => {
                const planSet = ex.sets.find((s) => s.setNo === setNo)
                return (
                  <div className="set-group" key={setNo}>
                    <div className="set-head">
                      {planSet ? (
                        <div className="set-target">
                          Set {setNo} · plan {targetText(planSet, ex) || 'no target'}
                          {planSet.note && <div className="muted note">{planSet.note}</div>}
                        </div>
                      ) : (
                        <div className="set-target">Set {setNo} · extra</div>
                      )}
                      {!logged.some((s) => s.exerciseId === ex.exerciseId && s.setNo === setNo) && (
                        <button className="link danger set-remove" onClick={() => removeSet(workout, ex, setNo)} aria-label={`Remove set ${setNo}`}>
                          Remove
                        </button>
                      )}
                    </div>
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
                          onDraft={(d) => {
                            setInputError(null)
                            setDrafts((prev) => ({ ...prev, [key]: d }))
                          }}
                          onToggle={() => toggle(ex, setNo, side, draft)}
                        />
                      )
                    })}
                  </div>
                )
              })}
              <div className="card-actions">
                <button className="link" onClick={() => addSet(workout, ex.exerciseId)}>
                  + Set
                </button>
                {!logged.some((s) => s.exerciseId === ex.exerciseId) && (
                  <button className="link" onClick={() => setReplacing(replacing === ex.exerciseId ? null : ex.exerciseId)} aria-expanded={replacing === ex.exerciseId}>
                    Replace
                  </button>
                )}
                {!logged.some((s) => s.exerciseId === ex.exerciseId) && (
                  <button className="link danger" onClick={() => removeExercise(workout, ex.exerciseId)}>
                    Remove exercise
                  </button>
                )}
              </div>
              {replacing === ex.exerciseId && !logged.some((s) => s.exerciseId === ex.exerciseId) && (
                <ReplacePanel
                  exerciseId={ex.exerciseId}
                  exclude={workout.plan.map((e) => e.exerciseId)}
                  onPick={(s) => void replaceWithSuggestion(workout, ex, s.exerciseId)}
                  onSearch={() => setReplaceSearch(ex.exerciseId)}
                  onCancel={() => setReplacing(null)}
                />
              )}
              {ex.backup && !logged.some((s) => s.exerciseId === ex.exerciseId) && !workout.plan.some((e) => e.exerciseId === ex.backup!.exerciseId) && (
                <button className="outline swap-backup" onClick={() => swapToBackup(workout, ex)}>
                  {ex.swapped ? `Back to ${ex.backup.name}` : `Machine taken? Do ${ex.backup.name}`}
                </button>
              )}
            </section>
          )
        })}

        <button className="primary add-exercise" onClick={() => setPicking(true)}>
          + Add exercise
        </button>

        <button className="link danger" onClick={() => discard()}>
          Discard workout
        </button>
      </main>
      {askFinish && (
        <FinishSheet
          askRoutine={workout.routineId === null}
          defaultName={suggestRoutineName()}
          exerciseCount={routineItems().length}
          onSaveRoutine={saveAsRoutine}
          onFinish={(feeling) => {
            setAskFinish(false)
            void completeFinish(workout.routineId, feeling)
          }}
          onCancel={() => setAskFinish(false)}
        />
      )}
      {picking && <ExercisePicker onPick={addExercise} onClose={() => setPicking(false)} taken={new Set(workout.plan.map((e) => e.exerciseId))} />}
      {replaceSearch && (
        <ExercisePicker
          onPick={(row) => {
            const old = workout.plan.find((e) => e.exerciseId === replaceSearch)
            if (old) void replaceExercise(workout, old, row)
          }}
          onClose={() => setReplaceSearch(null)}
          taken={new Set(workout.plan.map((e) => e.exerciseId))}
        />
      )}
      {rest && <RestTimer rest={rest} onChange={setRest} />}
    </div>
  )
}
