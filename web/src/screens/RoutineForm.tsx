import { useEffect, useState } from 'react'
import { FormSkeleton } from '../components/Skeleton'
import { Page } from '../components/Page'
import ExercisePicker from '../components/ExercisePicker'
import { useNav } from '../lib/nav'
import { db } from '../lib/db'
import { createRoutine, deleteRoutine, loadRoutineForEdit, regenerateRulesPlan, updateRoutine } from '../lib/routines'

type Item = { exerciseId: string; name: string; targetSets: number }

/** Create a routine (no id) or edit one: name, exercises in order, number of sets for each. */
export default function RoutineForm({ id }: { id?: string }) {
  const { back } = useNav()
  const [name, setName] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loaded, setLoaded] = useState(!id)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    loadRoutineForEdit(id)
      .then((r) => {
        setName(r.name)
        setItems(r.items)
        setLoaded(true)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  const move = (i: number, by: -1 | 1) =>
    setItems((list) => {
      const j = i + by
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const setSets = (i: number, by: number) =>
    setItems((list) => list.map((it, k) => (k === i ? { ...it, targetSets: Math.min(10, Math.max(1, it.targetSets + by)) } : it)))

  async function save() {
    setError(null)
    if (!name.trim()) return setError('Give the routine a name.')
    if (items.length === 0) return setError('Add at least one exercise.')
    setBusy(true)
    try {
      const list = items.map((it) => ({ exerciseId: it.exerciseId, targetSets: it.targetSets }))
      const routineId = id ?? (await createRoutine(name, list))
      if (id) await updateRoutine(id, name, list)
      await db.plans.delete(routineId) // the saved plan on this phone is out of date
      await regenerateRulesPlan(routineId)
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  async function remove() {
    if (!id || !window.confirm(`Delete “${name}”? Your past sessions stay in History.`)) return
    setBusy(true)
    try {
      await deleteRoutine(id)
      await db.plans.delete(id)
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Page title={id ? 'Edit routine' : 'New routine'}>
      {!loaded && !error && <FormSkeleton fields={3} />}
      {loaded && (
        <>
          <div className="card">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Legs" />
            </label>
          </div>

          <h2>Exercises</h2>
          {items.length === 0 && <p className="muted">No exercises yet.</p>}
          {items.map((it, i) => (
            <div className="card routine-item" key={it.exerciseId}>
              <div className="routine-item-name">{it.name}</div>
              <div className="routine-item-row">
                <div className="stepper" aria-label="Sets">
                  <button onClick={() => setSets(i, -1)} aria-label="Fewer sets">−</button>
                  <span>
                    {it.targetSets} {it.targetSets === 1 ? 'set' : 'sets'}
                  </span>
                  <button onClick={() => setSets(i, 1)} aria-label="More sets">+</button>
                </div>
                <div className="item-actions">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">↓</button>
                  <button className="danger" onClick={() => setItems((l) => l.filter((_, k) => k !== i))} aria-label="Remove">✕</button>
                </div>
              </div>
            </div>
          ))}
          <button className="outline" onClick={() => setPicking(true)}>
            + Add exercise
          </button>

          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save routine'}
          </button>
          <p className="muted note">
            Saving rebuilds the automatic plan for this routine. A plan Claude already wrote stays until you use it or ask Claude for a new one.
          </p>
          {id && (
            <button className="link danger" disabled={busy} onClick={remove}>
              Delete routine
            </button>
          )}
        </>
      )}
      {error && !loaded && <div className="card error">{error}</div>}
      {picking && (
        <ExercisePicker
          taken={new Set(items.map((i) => i.exerciseId))}
          onClose={() => setPicking(false)}
          onPick={(row) => {
            setPicking(false)
            setItems((l) => [...l, { exerciseId: row.id, name: row.name, targetSets: 3 }])
          }}
        />
      )}
    </Page>
  )
}
