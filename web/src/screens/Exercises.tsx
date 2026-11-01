import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNav } from '../lib/nav'
import { formatDayMonth, kgText } from '../lib/format'

type Row = {
  id: string
  name: string
  equipment: string | null
  loadType: string
  dumbbellPair: boolean
  sessions: number
  lastPerformedAt: string | null
  bestWeightKg: number | null
}

async function loadExercises(): Promise<Row[]> {
  const [ex, summary] = await Promise.all([
    supabase.from('exercises').select('id, name, equipment, load_type, dumbbell_pair').is('deleted_at', null),
    supabase.from('exercise_summary').select('exercise_id, sessions, last_performed_at, best_weight_kg'),
  ])
  if (ex.error) throw ex.error
  if (summary.error) throw summary.error
  const byId = new Map((summary.data ?? []).map((s) => [s.exercise_id as string, s]))
  return (ex.data ?? []).map((e) => {
    const s = byId.get(e.id)
    return {
      id: e.id,
      name: e.name,
      equipment: e.equipment,
      loadType: e.load_type,
      dumbbellPair: e.dumbbell_pair,
      sessions: Number(s?.sessions ?? 0),
      lastPerformedAt: (s?.last_performed_at as string | null) ?? null,
      bestWeightKg: (s?.best_weight_kg as number | null) ?? null,
    }
  })
}

export default function Exercises() {
  const { push } = useNav()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [offline, setOffline] = useState(false)
  // The search text survives opening an exercise and coming back.
  const [query, setQuery] = useState(() => sessionStorage.getItem('gl_ex_query') ?? '')
  useEffect(() => sessionStorage.setItem('gl_ex_query', query), [query])

  useEffect(() => {
    loadExercises()
      .then((r) => {
        localStorage.setItem('gl_exercises', JSON.stringify(r))
        setRows(r)
        setOffline(false)
      })
      .catch(() => {
        const saved = localStorage.getItem('gl_exercises')
        if (saved) setRows(JSON.parse(saved) as Row[])
        setOffline(true)
      })
  }, [])

  // Most recently done first, then the ones never done, alphabetically.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? [])
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => (b.lastPerformedAt ?? '').localeCompare(a.lastPerformedAt ?? '') || a.name.localeCompare(b.name))
  }, [rows, query])

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
