import { useEffect, useMemo, useState } from 'react'
import { Page } from '../components/Page'
import ExercisePicker from '../components/ExercisePicker'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useNav } from '../lib/nav'
import { num } from '../lib/format'
import type { ExerciseRow } from '../lib/exerciseList'

type Row = {
  key: string
  id: string | null // null = a set added in this editor
  exerciseId: string
  setNo: number
  side: 'L' | 'R' | null
  weight: string
  reps: string
  warmup: boolean
  removed: boolean
  origWeight: string
  origReps: string
}

type Info = { name: string; unilateral: boolean; dumbbellPair: boolean; first: string }

type Loaded = { title: string; routineId: string | null; startedAt: string; rows: Row[]; info: Record<string, Info> }

async function load(sessionId: string): Promise<Loaded> {
  const [s, sets] = await Promise.all([
    supabase.from('sessions').select('title, routine_id, started_at').eq('id', sessionId).single(),
    supabase
      .from('sets')
      .select('id, exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at, exercises(name, unilateral, dumbbell_pair)')
      .eq('session_id', sessionId)
      .is('deleted_at', null),
  ])
  if (s.error) throw new Error(s.error.message)
  if (sets.error) throw new Error(sets.error.message)

  const info: Record<string, Info> = {}
  const rows: Row[] = []
  for (const r of (sets.data ?? []) as unknown as {
    id: string
    exercise_id: string
    set_no: number
    side: 'L' | 'R' | null
    weight_kg: number | null
    reps: number | null
    is_warmup: boolean
    logged_at: string
    exercises: { name: string; unilateral: boolean; dumbbell_pair: boolean }
  }[]) {
    const i = info[r.exercise_id]
    if (!i || r.logged_at < i.first)
      info[r.exercise_id] = { name: r.exercises.name, unilateral: r.exercises.unilateral, dumbbellPair: r.exercises.dumbbell_pair, first: r.logged_at }
    const weight = r.weight_kg === null ? '' : num(r.weight_kg)
    const reps = r.reps === null ? '' : String(r.reps)
    rows.push({
      key: r.id,
      id: r.id,
      exerciseId: r.exercise_id,
      setNo: r.set_no,
      side: r.side,
      weight,
      reps,
      warmup: r.is_warmup,
      removed: false,
      origWeight: weight,
      origReps: reps,
    })
  }
  return { title: s.data.title as string, routineId: s.data.routine_id as string | null, startedAt: s.data.started_at as string, rows, info }
}

const sideOrder = (s: 'L' | 'R' | null) => (s === 'L' ? 0 : s === 'R' ? 1 : 2)

/** Correct a past session: change weights and reps, remove or add sets and exercises, rename or delete it.
 * Nothing is saved until you press Save, and then everything is applied together or not at all. */
export default function SessionEdit({ id }: { id: string }) {
  const { back } = useNav()
  const [data, setData] = useState<Loaded | null>(null)
  const [title, setTitle] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [info, setInfo] = useState<Record<string, Info>>({})
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    load(id)
      .then((d) => {
        setData(d)
        setTitle(d.title)
        setRows(d.rows)
        setInfo(d.info)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  const exerciseIds = useMemo(
    () => Object.keys(info).sort((a, b) => info[a].first.localeCompare(info[b].first) || info[a].name.localeCompare(info[b].name)),
    [info],
  )

  const patch = (key: string, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)))

  function addSet(exerciseId: string) {
    const mine = rows.filter((r) => r.exerciseId === exerciseId && !r.removed)
    const next = Math.max(0, ...mine.map((r) => r.setNo)) + 1
    const last = [...mine].sort((a, b) => a.setNo - b.setNo).pop()
    const sides: ('L' | 'R' | null)[] = info[exerciseId].unilateral ? ['L', 'R'] : [null]
    setRows((list) => [
      ...list,
      ...sides.map((side) => ({
        key: crypto.randomUUID(),
        id: null,
        exerciseId,
        setNo: next,
        side,
        weight: last?.weight ?? '',
        reps: '',
        warmup: false,
        removed: false,
        origWeight: '',
        origReps: '',
      })),
    ])
  }

  function addExercise(ex: ExerciseRow) {
    setPicking(false)
    setInfo((i) => ({ ...i, [ex.id]: { name: ex.name, unilateral: ex.unilateral, dumbbellPair: ex.dumbbellPair, first: '￿' + ex.name } }))
    const sides: ('L' | 'R' | null)[] = ex.unilateral ? ['L', 'R'] : [null]
    setRows((list) => [
      ...list,
      ...sides.map((side) => ({
        key: crypto.randomUUID(),
        id: null,
        exerciseId: ex.id,
        setNo: 1,
        side,
        weight: '',
        reps: '',
        warmup: false,
        removed: false,
        origWeight: '',
        origReps: '',
      })),
    ])
  }

  const removeExercise = (exerciseId: string) =>
    setRows((list) => list.map((r) => (r.exerciseId === exerciseId ? { ...r, removed: true } : r)).filter((r) => r.id !== null || !r.removed))

  async function save() {
    if (!data) return
    setError(null)
    const updates: { id: string; weight_kg: number | null; reps: number }[] = []
    const added: { exercise_id: string; set_no: number; side: string | null; weight_kg: number | null; reps: number }[] = []
    const deleted: string[] = []

    for (const r of rows) {
      if (r.removed) {
        if (r.id) deleted.push(r.id)
        continue
      }
      const reps = parseInt(r.reps, 10)
      const weight = r.weight.trim() === '' ? null : parseFloat(r.weight.replace(',', '.'))
      if (Number.isNaN(reps) || reps < 0) return setError(`${info[r.exerciseId].name}, set ${r.setNo}${r.side ? ' ' + r.side : ''}: enter the reps (0 or more).`)
      if (weight !== null && (Number.isNaN(weight) || weight < 0)) return setError(`${info[r.exerciseId].name}, set ${r.setNo}: the weight looks wrong.`)
      if (r.id === null) added.push({ exercise_id: r.exerciseId, set_no: r.setNo, side: r.side, weight_kg: weight, reps })
      else if (r.weight !== r.origWeight || r.reps !== r.origReps) updates.push({ id: r.id, weight_kg: weight, reps })
    }
    const titleChanged = title.trim() !== data.title
    if (!titleChanged && updates.length === 0 && added.length === 0 && deleted.length === 0) return back()
    if (!title.trim()) return setError('The session needs a title.')

    setBusy(true)
    const { error: e } = await supabase.rpc('edit_session', {
      p_session_id: id,
      p_title: titleChanged ? title.trim() : null,
      p_updates: updates,
      p_deleted: deleted,
      p_added: added,
    })
    if (e) {
      setBusy(false)
      return setError(e.message.includes('duplicate') ? 'Two sets have the same number. Remove one first.' : e.message)
    }
    await afterChange()
    back()
  }

  /** Forget what this phone saved about the session and the routine's plan: both just changed. */
  async function afterChange() {
    localStorage.removeItem(`gl_session_${id}`)
    localStorage.removeItem('gl_history')
    if (data?.routineId) {
      localStorage.removeItem(`gl_routine_page_${data.routineId}`)
      await db.plans.delete(data.routineId)
    }
  }

  async function removeSession() {
    if (!data || !window.confirm('Delete this whole session? It disappears from History, stats and charts.')) return
    setBusy(true)
    const { error: e } = await supabase.rpc('delete_session', { p_session_id: id })
    if (e) {
      setBusy(false)
      return setError(e.message)
    }
    await afterChange()
    history.go(-2) // past this editor and the session page that no longer exists
  }

  return (
    <Page title="Edit session">
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="card">
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>

          {exerciseIds.map((exId) => {
            const mine = rows.filter((r) => r.exerciseId === exId && !r.removed).sort((a, b) => a.setNo - b.setNo || sideOrder(a.side) - sideOrder(b.side))
            if (mine.length === 0 && !rows.some((r) => r.exerciseId === exId && !r.removed)) return null
            return (
              <section className="card exercise" key={exId}>
                <div className="ex-title static">{info[exId].name}</div>
                {info[exId].dumbbellPair && <p className="muted note edit-hint">Weight is the total of both dumbbells.</p>}
                <div className="edit-row head muted">
                  <span>Set</span>
                  <span>kg</span>
                  <span>Reps</span>
                  <span />
                </div>
                {mine.map((r) => (
                  <div className="edit-row" key={r.key}>
                    {/* show the position (1, 2, 3...), not the stored number, so a removed set leaves no gap */}
                    <span className="set-label">{r.warmup ? 'W' : `${[...new Set(mine.map((m) => m.setNo))].indexOf(r.setNo) + 1}${r.side ?? ''}`}</span>
                    <input inputMode="decimal" aria-label="Weight in kg" value={r.weight} onFocus={(e) => e.target.select()} onChange={(e) => patch(r.key, { weight: e.target.value })} />
                    <input inputMode="numeric" aria-label="Reps" value={r.reps} onFocus={(e) => e.target.select()} onChange={(e) => patch(r.key, { reps: e.target.value })} />
                    <button className="icon-btn" aria-label="Remove this set" onClick={() => (r.id ? patch(r.key, { removed: true }) : setRows((l) => l.filter((x) => x.key !== r.key)))}>
                      ✕
                    </button>
                  </div>
                ))}
                <div className="card-actions">
                  <button className="link" onClick={() => addSet(exId)}>
                    + Set
                  </button>
                  <button className="link danger" onClick={() => removeExercise(exId)}>
                    Remove exercise
                  </button>
                </div>
              </section>
            )
          })}

          <button className="outline" onClick={() => setPicking(true)}>
            + Add exercise
          </button>

          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <p className="muted note">
            Changes apply together. Saving also rebuilds this routine’s automatic plan from the corrected numbers; a plan Claude already wrote stays.
          </p>
          <button className="link danger" disabled={busy} onClick={removeSession}>
            Delete session
          </button>
        </>
      )}
      {error && !data && <div className="card error">{error}</div>}
      {picking && <ExercisePicker taken={new Set(exerciseIds)} onClose={() => setPicking(false)} onPick={addExercise} />}
    </Page>
  )
}
