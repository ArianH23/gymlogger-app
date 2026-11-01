import { useState } from 'react'
import { useBackToClose } from '../lib/overlay'

type Props = {
  defaultName: string
  exerciseCount: number
  onSave: (name: string) => Promise<void> // throws a readable Error if it can't save
  onSkip: () => void // finish without saving a routine
  onCancel: () => void // go back to the workout
}

/** Shown when you finish an empty workout: offers to keep it as a routine. */
export default function SaveRoutineSheet({ defaultName, exerciseCount, onSave, onSkip, onCancel }: Props) {
  useBackToClose(true, onCancel)
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return setError('Give the routine a name.')
    setBusy(true)
    setError(null)
    try {
      await onSave(name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="overlay sheet" role="dialog" aria-label="Save as routine">
      <div className="overlay-inner">
        <h1>Save as routine?</h1>
        <p className="muted">
          Keep these {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'} as a routine you can start again. It gets planned like
          Workout A, B and C.
        </p>
        <div className="card">
          <label>
            Routine name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save routine and finish'}
          </button>
        </div>
        <button className="outline" disabled={busy} onClick={onSkip}>
          Finish without saving
        </button>
        <button className="link" disabled={busy} onClick={onCancel}>
          Back to workout
        </button>
      </div>
    </div>
  )
}
