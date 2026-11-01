import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useNav } from '../lib/nav'
import { formatDate } from '../lib/format'
import { loadScores, type Score } from '../lib/score'
import ScoreBadge from '../components/ScoreBadge'

type SessionRow = { id: string; title: string; started_at: string; ended_at: string | null; set_count: number; score?: Score | null }

const PAGE = 30

function minutes(a: string, b: string | null) {
  if (!b) return null
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m > 0 && m < 600 ? m : null
}

export default function History() {
  const { push } = useNav()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const waiting = useLiveQuery(() => db.workouts.filter((w) => !!w.endedAt && !w.syncedAt).toArray(), [])

  const loadPage = useCallback(async (from: number) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, started_at, ended_at, sets(count)')
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
    const scores = await loadScores((data ?? []).map((s) => s.id as string)).catch(() => new Map<string, Score>()) // a bonus: the list works without it
    const rows = (data ?? []).map((s) => ({
      id: s.id as string,
      title: s.title as string,
      started_at: s.started_at as string,
      ended_at: s.ended_at as string | null,
      set_count: (s.sets as unknown as { count: number }[])[0]?.count ?? 0,
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

  const waitingIds = new Set((waiting ?? []).map((w) => w.id))

  return (
    <>
      <h1>History</h1>
      {offline && <p className="muted">No signal: showing the last list that was loaded.</p>}

      {waiting?.map((w) => (
        <div className="card" key={w.id}>
          <div className="routine-title">{w.title}</div>
          <div className="muted">{formatDate(w.startedAt)}</div>
          <span className="badge">waiting to upload</span>
        </div>
      ))}

      {sessions
        .filter((s) => !waitingIds.has(s.id))
        .map((s) => {
          const mins = minutes(s.started_at, s.ended_at)
          return (
            <button className="card list-item" key={s.id} onClick={() => push({ type: 'session', id: s.id })}>
              <span className="routine-title">{s.title}</span>
              <span className="muted">
                {formatDate(s.started_at)} · {s.set_count} sets{mins ? ` · ${mins} min` : ''}
              </span>
              <ScoreBadge score={s.score} />
            </button>
          )
        })}

      {more && (
        <button className="primary" disabled={loading} onClick={() => loadPage(sessions.length)}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      {!more && sessions.length === 0 && !loading && <p className="muted">No sessions yet.</p>}

      <button className="link" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </>
  )
}
