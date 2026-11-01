import { useEffect, useMemo, useState } from 'react'
import { loadExerciseList, sortAndFilter, type ExerciseRow as Row } from '../lib/exerciseList'
import { useNav } from '../lib/nav'
import { formatDayMonth, kgText } from '../lib/format'

export default function Exercises() {
  const { push } = useNav()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [offline, setOffline] = useState(false)
  // The search text survives opening an exercise and coming back.
  const [query, setQuery] = useState(() => sessionStorage.getItem('gl_ex_query') ?? '')
  useEffect(() => sessionStorage.setItem('gl_ex_query', query), [query])

  useEffect(() => {
    loadExerciseList().then((r) => {
      if (r) setRows(r.rows)
      setOffline(r?.offline ?? true)
    })
  }, [])

  const shown = useMemo(() => sortAndFilter(rows ?? [], query), [rows, query])

  return (
    <>
      <div className="title-row">
        <h1>Exercises</h1>
        <button className="chip on" onClick={() => push({ type: 'exerciseForm' })}>
          + New
        </button>
      </div>
      <input
        className="search"
        type="search"
        placeholder="Search exercises"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {offline && <p className="muted">No signal: showing the last list that was loaded.</p>}
      {!rows && !offline && <p className="muted">Loading…</p>}
      {shown.map((r) => (
        <button className="card list-item" key={r.id} onClick={() => push({ type: 'exercise', id: r.id })}>
          <span className="routine-title">{r.name}</span>
          <span className="muted">
            {r.sessions > 0
              ? `${r.sessions} ${r.sessions === 1 ? 'session' : 'sessions'} · last ${formatDayMonth(r.lastPerformedAt!)}` +
                (r.bestWeightKg !== null ? ` · best ${kgText(r.bestWeightKg, r)}` : '')
              : 'never done'}
          </span>
        </button>
      ))}
      {rows && shown.length === 0 && <p className="muted">No exercise matches “{query}”.</p>}
    </>
  )
}
