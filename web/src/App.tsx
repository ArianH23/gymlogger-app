import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './screens/Login'
import Routines from './screens/Routines'
import ActiveWorkout from './screens/ActiveWorkout'
import { db } from './lib/db'
import { syncPending } from './lib/sync'

type Tab = 'routines' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'routines', label: 'Routines' },
  { id: 'history', label: 'History' },
]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = still checking
  const [tab, setTab] = useState<Tab>('routines')
  const [openWorkout, setOpenWorkout] = useState<string | null>(null)

  // Reopening the app mid-workout takes you straight back to it.
  useEffect(() => {
    db.workouts.filter((w) => !w.endedAt).first().then((w) => w && setOpenWorkout(w.id))
  }, [])

  // Upload anything waiting: when the app opens and whenever the connection comes back.
  useEffect(() => {
    if (!session) return
    void syncPending()
    const retry = () => void syncPending()
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [session])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  if (session === null) return <div className="app"><Login /></div>
  if (openWorkout) return <ActiveWorkout workoutId={openWorkout} onExit={() => setOpenWorkout(null)} />

  return (
    <div className="app">
      <main className="screen">
        {tab === 'routines' ? (
          <Routines onOpen={setOpenWorkout} />
        ) : (
          <>
            <h1>History</h1>
            <div className="card">
              <strong>Your past sessions will appear here.</strong>
              <p className="muted">Built after the logging screen.</p>
            </div>
            <button className="link" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </>
        )}
      </main>

      <nav className="nav">
        <div className="nav-inner">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
