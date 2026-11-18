import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useNav } from '../lib/nav'
import { formatDate } from '../lib/format'
import { loadScores, type Score } from '../lib/score'
import { loadSetCounts } from '../lib/setCounts'
import { formatDuration, formatKm, formatPace, loadRuns, type RunRow } from '../lib/runs'
import ScoreBadge from '../components/ScoreBadge'
import { ListSkeleton } from '../components/Skeleton'
import StreakStats from '../components/StreakStats'
import WorkoutCalendar from '../components/WorkoutCalendar'
import RunImport from '../components/RunImport'
import RunTrends from '../components/RunTrends'

type SessionRow = { id: string; title: string; started_at: string; ended_at: string | null; set_count: number | null; score?: Score | null }
type Show = 'all' | 'workouts' | 'runs'
type Item = { kind: 'workout'; at: string; session: SessionRow } | { kind: 'run'; at: string; run: RunRow }

const PAGE = 30

function minutes(a: string, b: string | null) {
  if (!b) return null
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m > 0 && m < 600 ? m : null
}

const monthLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

export default function History() {
  const { push } = useNav()
  // which list is shown is remembered while the app is open, so coming back from a run or a session keeps your place
  const [show, setShowState] = useState<Show>(() => (sessionStorage.getItem('gl_history_show') as Show | null) ?? 'all')
  const setShow = (s: Show) => {
    sessionStorage.setItem('gl_history_show', s)
    setShowState(s)
  }
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(true) // the first page is loading when the screen opens
  const [offline, setOffline] = useState(false)
  const [runs, setRuns] = useState<RunRow[] | null>(null) // null = still loading
  const [runsVersion, setRunsVersion] = useState(0) // goes up after an import, to reload the runs, the trends and the calendar
  const waiting = useLiveQuery(() => db.workouts.filter((w) => !!w.endedAt && !w.syncedAt).toArray(), [])

  const loadPage = useCallback(async (from: number) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, started_at, ended_at')
      .is('deleted_at', null)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .range(from, from + PAGE - 1)
    setLoading(false)
    if (error) {
      const saved = localStorage.getItem('gl_history')
      if (saved && from === 0) setSessions(JSON.parse(saved) as SessionRow[])
      setOffline(true)
      setMore(false)
      return
    }
    setOffline(false)
    const ids = (data ?? []).map((s) => s.id as string)
    const scores = await loadScores(ids).catch(() => new Map<string, Score>()) // a bonus: the list works without it
    const counts = await loadSetCounts(ids).catch(() => null) // also a bonus: without it the list shows no set count rather than a wrong one
    const rows = (data ?? []).map((s) => ({
      id: s.id as string,
      title: s.title as string,
      started_at: s.started_at as string,
      ended_at: s.ended_at as string | null,
      set_count: counts ? (counts.get(s.id as string) ?? 0) : null,
      score: scores.get(s.id as string) ?? null,
    }))
    setMore(rows.length === PAGE)
    setSessions((prev) => {
      const next = from === 0 ? rows : [...prev, ...rows]
      if (from === 0) localStorage.setItem('gl_history', JSON.stringify(next))
      return next
    })
  }, [])

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  useEffect(() => {
    let alive = true
    loadRuns()
      .then((r) => alive && setRuns(r.runs))
      .catch(() => alive && setRuns([])) // the workouts still show without the runs
    return () => {
      alive = false
    }
  }, [runsVersion])

  // One list, newest first. Workouts come a page at a time, so in "All" a run older than the oldest workout loaded so far
  // waits until that page is loaded: otherwise it would show above workouts that are not on screen yet.
  const items = useMemo(() => {
    const waitingIds = new Set((waiting ?? []).map((w) => w.id))
    const workouts: Item[] = sessions.filter((s) => !waitingIds.has(s.id)).map((s) => ({ kind: 'workout', at: s.started_at, session: s }))
    const allRuns: Item[] = (runs ?? []).map((r) => ({ kind: 'run', at: r.startedAt, run: r }))
    if (show === 'workouts') return workouts
    if (show === 'runs') return allRuns
    const oldest = sessions.length > 0 ? sessions[sessions.length - 1].started_at : null
    const shownRuns = more && oldest ? allRuns.filter((r) => new Date(r.at) >= new Date(oldest)) : allRuns
    return [...workouts, ...shownRuns].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [sessions, runs, waiting, show, more])

  const firstLoad = (show !== 'runs' && loading && sessions.length === 0 && !offline) || (show === 'runs' && runs === null)

  return (
    <>
      <h1>History</h1>
      <StreakStats key={`s${runsVersion}`} />
      <WorkoutCalendar key={`c${runsVersion}`} />

      <div className="segmented" role="tablist">
        {(['all', 'workouts', 'runs'] as Show[]).map((s) => (
          <button key={s} role="tab" aria-selected={show === s} className={show === s ? 'on' : ''} onClick={() => setShow(s)}>
            {s === 'all' ? 'All' : s === 'workouts' ? 'Workouts' : 'Runs'}
          </button>
        ))}
      </div>

      {show === 'runs' && (
        <>
          <RunImport
            onImported={(runId) => {
              setRunsVersion((v) => v + 1)
              push({ type: 'run', id: runId })
            }}
          />
          <RunTrends version={runsVersion} />
        </>
      )}

      {offline && <p className="muted">No signal: showing the last list that was loaded.</p>}
      {firstLoad && <ListSkeleton rows={6} />}

      {show !== 'runs' &&
        waiting?.map((w) => (
          <div className="card" key={w.id}>
            <div className="routine-title">{w.title}</div>
            <div className="muted">{formatDate(w.startedAt)}</div>
            <span className="badge">{w.syncError ? 'refused by the server' : 'waiting to upload'}</span>
          </div>
        ))}

      {items.map((it, i) => {
        const month = monthLabel(it.at)
        const newMonth = i === 0 || monthLabel(items[i - 1].at) !== month
        if (it.kind === 'run') {
          const r = it.run
          return (
            <Fragment key={`r${r.id}`}>
              {newMonth && <h2 className="month">{month}</h2>}
              <button className="card list-item run-item" onClick={() => push({ type: 'run', id: r.id })}>
                <span className="routine-title">
                  <i className="kind-dot run" aria-hidden="true" />
                  {r.title}
                </span>
                <span className="muted">
                  {formatDate(r.startedAt)} · run · {formatKm(r.distanceKm)} km · {formatDuration(r.movingS)} · {formatPace(r.paceSPerKm)} /km
                </span>
              </button>
            </Fragment>
          )
        }
        const s = it.session
        const mins = minutes(s.started_at, s.ended_at)
        return (
          <Fragment key={s.id}>
            {newMonth && <h2 className="month">{month}</h2>}
            <button className="card list-item" onClick={() => push({ type: 'session', id: s.id })}>
              <span className="routine-title">{s.title}</span>
              <span className="muted">
                {formatDate(s.started_at)}
                {s.set_count === null ? '' : ` · ${s.set_count} ${s.set_count === 1 ? 'set' : 'sets'}`}
                {mins ? ` · ${mins} min` : ''}
              </span>
              <ScoreBadge score={s.score} />
            </button>
          </Fragment>
        )
      })}

      {show !== 'runs' && more && sessions.length > 0 && (
        <button className="primary" disabled={loading} onClick={() => loadPage(sessions.length)}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      {show !== 'runs' && !more && items.length === 0 && !loading && <p className="muted">No sessions yet.</p>}
      {show === 'runs' && runs !== null && runs.length === 0 && <p className="muted">No runs yet. Import one from Google Health.</p>}

      <button className="link" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </>
  )
}
