import { useState } from 'react'
import { useBackToClose } from '../lib/overlay'
import { FEELINGS } from '../lib/score'

type Props = {
  askRoutine: boolean // an empty (routine-less) workout can be kept as a routine
  defaultName: string
  exerciseCount: number
  onFinish: (feeling: number | null) => void // finish without saving a routine
  onSaveRoutine: (name: string, feeling: number | null) => Promise<void> // throws a readable Error if it can't save
  onCancel: () => void // go back to the workout
}

/** Shown when you tap Finish: the optional 1-5 "how did it feel" tap and, for an empty workout, saving it as a routine. */
export default function FinishSheet({ askRoutine, defaultName, exerciseCount, onFinish, onSaveRoutine, onCancel }: Props) {
  useBackToClose(true, onCancel)
  const [feeling, setFeeling] = useState<number | null>(null)
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return setError('Give the routine a name.')
    setBusy(true)
    setError(null)
    try {
      await onSaveRoutine(name, feeling)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="overlay sheet" role="dialog" aria-label="Finish workout">
      <div className="overlay-inner">
        <h1>Finish workout</h1>

        <div className="card">
          <strong>How did it feel?</strong>
          <p className="muted">Optional. Tap again to clear. Claude reads it next to your score when planning.</p>
          <div className="feeling-row" role="group" aria-label="How did it feel, 1 to 5">
            {FEELINGS.map((label, i) => {
              const value = i + 1
              return (
                <button
                  key={value}
                  className={`feeling${feeling === value ? ' on' : ''}`}
                  aria-pressed={feeling === value}
                  disabled={busy}
                  onClick={() => setFeeling(feeling === value ? null : value)}
                >
                  <span className="feeling-num">{value}</span>
                  <span className="feeling-label">{label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {askRoutine ? (
          <>
            <div className="card">
              <strong>Save as routine?</strong>
              <p className="muted">
                Keep these {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'} as a routine you can start again. It gets
                planned like Workout A, B and C.
              </p>
              <label>
                Routine name
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save routine and finish'}
              </button>
            </div>
            <button className="outline" disabled={busy} onClick={() => onFinish(feeling)}>
              Finish without saving
            </button>
          </>
        ) : (
          <button className="primary" disabled={busy} onClick={() => onFinish(feeling)}>
            Finish
          </button>
        )}
        <button className="link" disabled={busy} onClick={onCancel}>
          Back to workout
        </button>
      </div>
    </div>
  )
}
