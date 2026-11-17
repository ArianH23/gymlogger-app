import { useEffect, useState } from 'react'
import { FormSkeleton } from '../components/Skeleton'
import { Page } from '../components/Page'
import ExercisePicker from '../components/ExercisePicker'
import { useNav } from '../lib/nav'
import { db } from '../lib/db'
import {
  createRoutine,
  deleteRoutine,
  loadRoutineForEdit,
  regenerateRulesPlan,
  suggestBackups,
  suggestionWhy,
  updateRoutine,
  type BackupSuggestion,
} from '../lib/routines'

type Item = { exerciseId: string; name: string; targetSets: number; backupId?: string | null; backupName?: string | null }

/** Create a routine (no id) or edit one: name, exercises in order, number of sets for each. */
export default function RoutineForm({ id }: { id?: string }) {
  const { back } = useNav()
  const [name, setName] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loaded, setLoaded] = useState(!id)
  const [picking, setPicking] = useState(false)
  const [backupFor, setBackupFor] = useState<string | null>(null) // the exercise whose backup is being picked
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // suggested backups: the list shown under one exercise, and the note after "Suggest for all"
  const [suggesting, setSuggesting] = useState<{ exerciseId: string; list: BackupSuggestion[] | null; error: string | null } | null>(null)
  const [fillNote, setFillNote] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)

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

  const setBackup = (exerciseId: string, backupId: string | null, backupName: string | null) => {
    setItems((l) => l.map((x) => (x.exerciseId === exerciseId ? { ...x, backupId, backupName } : x)))
    setSuggesting(null)
  }

  /** Shows the best matches for one exercise under it. Nothing is chosen until you tap Use. */
  async function suggest(exerciseId: string) {
    if (suggesting?.exerciseId === exerciseId) return setSuggesting(null) // a second tap closes it
    setSuggesting({ exerciseId, list: null, error: null })
    try {
      const list = await suggestBackups(exerciseId, items.map((x) => x.exerciseId))
      setSuggesting((s) => (s?.exerciseId === exerciseId ? { exerciseId, list, error: null } : s))
    } catch {
      setSuggesting((s) => (s?.exerciseId === exerciseId ? { exerciseId, list: null, error: 'No signal: suggestions need a connection. You can still choose one yourself.' } : s))
    }
  }

  /** Gives every exercise without a backup its best match, each backup used once. Change or clear any of them before saving. */
  async function suggestAll() {
    setFilling(true)
    setFillNote(null)
    setSuggesting(null)
    try {
      const used = new Set([...items.map((x) => x.exerciseId), ...items.map((x) => x.backupId).filter((x): x is string => !!x)])
      const chosen = new Map<string, BackupSuggestion>()
      for (const it of items) {
        if (it.backupId) continue
        const best = (await suggestBackups(it.exerciseId, [...used], 1))[0]
        if (best) {
          chosen.set(it.exerciseId, best)
          used.add(best.exerciseId)
        }
      }
      setItems((l) => l.map((x) => (chosen.has(x.exerciseId) ? { ...x, backupId: chosen.get(x.exerciseId)!.exerciseId, backupName: chosen.get(x.exerciseId)!.name } : x)))
      const missing = items.filter((x) => !x.backupId && !chosen.has(x.exerciseId)).length
      setFillNote(
        `${chosen.size} ${chosen.size === 1 ? 'backup' : 'backups'} suggested${missing ? `, ${missing} without a good match` : ''}. Nothing is saved until you save the routine.`,
      )
    } catch {
      setFillNote('No signal: suggestions need a connection.')
    }
    setFilling(false)
  }

  async function save() {
    setError(null)
    if (!name.trim()) return setError('Give the routine a name.')
    if (items.length === 0) return setError('Add at least one exercise.')
    setBusy(true)
    try {
      const list = items.map((it) => ({ exerciseId: it.exerciseId, targetSets: it.targetSets, backupId: it.backupId ?? null }))
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
              <div className="routine-backup">
                <span className="muted">Backup{it.backupName ? '' : ': none'}</span>
                {it.backupName && <span className="routine-backup-name">{it.backupName}</span>}
                {!it.backupName && (
                  <button className="link" onClick={() => suggest(it.exerciseId)} aria-expanded={suggesting?.exerciseId === it.exerciseId}>
                    Suggest
                  </button>
                )}
                <button className="link" onClick={() => setBackupFor(it.exerciseId)}>
                  {it.backupName ? 'Change' : 'Choose'}
                </button>
                {it.backupName && (
                  <button className="link danger" onClick={() => setBackup(it.exerciseId, null, null)}>
                    Clear
                  </button>
                )}
              </div>
              {suggesting?.exerciseId === it.exerciseId && (
                <div className="suggestions" aria-live="polite">
                  {suggesting.list === null && !suggesting.error && <p className="muted note">Looking for exercises that work the same muscles…</p>}
                  {suggesting.error && <p className="muted note">{suggesting.error}</p>}
                  {suggesting.list?.length === 0 && (
                    <p className="muted note">Nothing close enough was found (an exercise needs muscle tags to be matched). Use Choose to pick one yourself.</p>
                  )}
                  {suggesting.list?.map((s) => (
                    <div className="suggestion" key={s.exerciseId}>
                      <div className="suggestion-text">
                        <div>{s.name}</div>
                        <small className="muted">{suggestionWhy(s)}</small>
                      </div>
                      <button
                        className="link"
                        onClick={() => setBackup(it.exerciseId, s.exerciseId, s.name)}
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button className="outline" onClick={() => setPicking(true)}>
            + Add exercise
          </button>
          {items.some((it) => !it.backupId) && (
            <button className="outline" disabled={filling} onClick={suggestAll}>
              {filling ? 'Looking…' : 'Suggest backups for the rest'}
            </button>
          )}
          {fillNote && <p className="muted note">{fillNote}</p>}

          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save routine'}
          </button>
          <p className="muted note">
            A backup is what you do instead when the machine is taken: the workout offers it with one tap, starting from what you did last time.
          </p>
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
      {backupFor && (
        <ExercisePicker
          taken={new Set(items.map((i) => i.exerciseId))}
          onClose={() => setBackupFor(null)}
          onPick={(row) => {
            setBackup(backupFor, row.id, row.name)
            setBackupFor(null)
          }}
        />
      )}
    </Page>
  )
}
