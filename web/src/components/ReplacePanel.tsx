import { useEffect, useState } from 'react'
import { suggestBackups, suggestionWhy, type BackupSuggestion } from '../lib/routines'

/**
 * Under an exercise: the closest matches to replace it with (the same muscles), and a way to search every exercise instead.
 * The matches need signal; without it the search still works from the saved list.
 */
export default function ReplacePanel({
  exerciseId,
  exclude,
  onPick,
  onSearch,
  onCancel,
}: {
  exerciseId: string
  exclude: string[]
  onPick: (s: BackupSuggestion) => void
  onSearch: () => void
  onCancel: () => void
}) {
  const [list, setList] = useState<BackupSuggestion[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    suggestBackups(exerciseId, exclude, 4)
      .then((l) => alive && setList(l))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseId])

  return (
    <div className="suggestions" aria-live="polite">
      <p className="muted note replace-title">Replace with</p>
      {list === null && !error && <p className="muted note">Looking for exercises that work the same muscles…</p>}
      {error && <p className="muted note">No signal: suggestions need a connection. You can still search the saved list.</p>}
      {list?.length === 0 && <p className="muted note">Nothing close enough was found. Search all exercises instead.</p>}
      {list?.map((s) => (
        <div className="suggestion" key={s.exerciseId}>
          <div className="suggestion-text">
            <div>{s.name}</div>
            <small className="muted">{suggestionWhy(s)}</small>
          </div>
          <button className="link" onClick={() => onPick(s)}>
            Use
          </button>
        </div>
      ))}
      <div className="replace-more">
        <button className="link" onClick={onSearch}>
          Search all exercises
        </button>
        <button className="link muted" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
