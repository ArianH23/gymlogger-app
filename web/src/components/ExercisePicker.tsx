import { useEffect, useMemo, useState } from 'react'
import { ListSkeleton } from './Skeleton'
import { loadExerciseList, sortAndFilter, type ExerciseRow } from '../lib/exerciseList'
import { useBackToClose } from '../lib/overlay'
import { formatDayMonth } from '../lib/format'

type Props = {
  onPick: (exercise: ExerciseRow) => void
  onClose: () => void
  /** exercises already in the workout or routine: shown greyed out */
  taken?: Set<string>
}

/** Full-screen list to choose an exercise from. Works offline from the saved copy of the list. */
export default function ExercisePicker({ onPick, onClose, taken }: Props) {
  useBackToClose(true, onClose)
  const [rows, setRows] = useState<ExerciseRow[] | null>(null)
  const [offline, setOffline] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    loadExerciseList().then((r) => {
      setRows(r?.rows ?? [])
      setOffline(r?.offline ?? true)
    })
  }, [])

  const shown = useMemo(() => sortAndFilter(rows ?? [], query), [rows, query])

  return (
    <div className="overlay" role="dialog" aria-label="Choose an exercise">
      <div className="overlay-inner">
        <div className="page-bar">
          <button className="link" onClick={onClose}>
            Cancel
          </button>
        </div>
        <h1>Add exercise</h1>
        <input className="search" type="search" placeholder="Search exercises" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {offline && <p className="muted">No signal: showing the last list that was loaded.</p>}
        {!rows && <ListSkeleton rows={6} />}
        {shown.map((r) => {
          const inUse = taken?.has(r.id)
          return (
            <button className="card list-item" key={r.id} disabled={inUse} style={inUse ? { opacity: 0.45 } : undefined} onClick={() => onPick(r)}>
              <span className="routine-title">{r.name}</span>
              <span className="muted">
                {inUse ? 'already here' : r.sessions > 0 ? `${r.sessions} sessions · last ${formatDayMonth(r.lastPerformedAt!)}` : 'never done'}
              </span>
            </button>
          )
        })}
        {rows && shown.length === 0 && <p className="muted">No exercise matches “{query}”. Create it from the Exercises tab first.</p>}
      </div>
    </div>
  )
}
