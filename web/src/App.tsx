import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from './lib/supabase'
import Login from './screens/Login'
import Routines from './screens/Routines'
import ActiveWorkout from './screens/ActiveWorkout'
import History from './screens/History'
import Exercises from './screens/Exercises'
import Body from './screens/Body'
import { PageFor } from './screens/Pages'
import { NavProvider, useNav } from './lib/nav'
import { db } from './lib/db'
import { syncPending } from './lib/sync'

type Tab = 'routines' | 'exercises' | 'history' | 'body'

const TABS: { id: Tab; label: string }[] = [
  { id: 'routines', label: 'Routines' },
  { id: 'exercises', label: 'Exercises' },
  { id: 'history', label: 'History' },
  { id: 'body', label: 'Body' },
]

function Shell() {
  const { stack, popToRoot, openWorkoutId: openWorkout, setOpenWorkoutId: setOpenWorkout } = useNav()
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = still checking
  const [tab, setTab] = useState<Tab>('routines')
  const unfinished = useLiveQuery(() => db.workouts.filter((w) => !w.endedAt).first(), []) // the one open workout, if any

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

  const page = stack.length > 0 ? stack[stack.length - 1] : null

  // A floating way back to the open workout, whenever it is open but not the screen you are looking at.
  const workoutOnScreen = !!openWorkout && page === null
  const backToWorkout =
    unfinished && !workoutOnScreen ? (
      <button
        className="resume-fab"
        onClick={() => {
          setOpenWorkout(unfinished.id)
          popToRoot() // close any pages on top, so the workout is what you see
        }}
      >
        ‹ Back to {unfinished.title}
      </button>
    ) : null

  if (openWorkout) {
    // The workout stays mounted (but hidden) while a page is open on top of it,
    // so typed values and the rest timer survive a look at an exercise's stats.
    return (
      <>
        <div hidden={page !== null}>
          <ActiveWorkout workoutId={openWorkout} onExit={() => setOpenWorkout(null)} />
        </div>
        {page && <PageFor view={page} />}
        {backToWorkout}
      </>
    )
  }

  if (page)
    return (
      <>
        <PageFor view={page} />
        {backToWorkout}
      </>
    )

  return (
    <div className="app">
      <main className="screen">
        {tab === 'routines' ? <Routines onOpen={setOpenWorkout} /> : tab === 'exercises' ? <Exercises /> : tab === 'body' ? <Body /> : <History />}
      </main>

      {backToWorkout}

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

export default function App() {
  return (
    <NavProvider>
      <Shell />
    </NavProvider>
  )
}
