import { useEffect, useState, type ReactNode } from 'react'
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
import { IconBody, IconExercises, IconHistory, IconRoutines } from './components/Icons'
import { db } from './lib/db'
import { syncPending } from './lib/sync'
import { readStoredSession } from './lib/storedSession'

type Tab = 'routines' | 'exercises' | 'history' | 'body'

const TABS: { id: Tab; label: string; icon: () => ReactNode }[] = [
  { id: 'routines', label: 'Routines', icon: IconRoutines },
  { id: 'exercises', label: 'Exercises', icon: IconExercises },
  { id: 'history', label: 'History', icon: IconHistory },
  { id: 'body', label: 'Body', icon: IconBody },
]

/** "12 min", "1 h 05" */
function elapsed(startedAt: string, now: number) {
  const m = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

function Shell() {
  const { stack, popToRoot, openWorkoutId: openWorkout, setOpenWorkoutId: setOpenWorkout } = useNav()
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = still checking
  const [tab, setTab] = useState<Tab>('routines')
  const unfinished = useLiveQuery(() => db.workouts.filter((w) => !w.endedAt).first(), []) // the one open workout, if any
  const unfinishedId = unfinished?.id
  const unfinishedSets = useLiveQuery(() => (unfinishedId ? db.sets.where('sessionId').equals(unfinishedId).count() : 0), [unfinishedId])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!unfinishedId) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30000) // keeps the elapsed time on the pill current
    return () => clearInterval(t)
  }, [unfinishedId])

  // Reopening the app mid-workout takes you straight back to it.
  useEffect(() => {
    db.workouts.filter((w) => !w.endedAt).first().then((w) => w && setOpenWorkout(w.id))
  }, [])

  // Keep this phone and the other devices in step: when the app opens, whenever the connection comes back or the app
  // is shown again, and every few seconds while it is open (a workout started on the watch appears here).
  useEffect(() => {
    if (!session) return
    void syncPending()
    const retry = () => void syncPending()
    const whenShown = () => document.visibilityState === 'visible' && retry()
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', whenShown)
    const timer = setInterval(whenShown, 6000)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', whenShown)
      clearInterval(timer)
    }
  }, [session])

  useEffect(() => {
    // With no signal an expired login cannot be renewed and the library reports no session; the login is still saved on this device,
    // so the app stays open (the workout is on the phone) instead of showing the sign-in screen. Signing out removes the saved login.
    const keep = (s: Session | null) => s ?? readStoredSession()
    supabase.auth.getSession().then(({ data }) => setSession(keep(data.session)))
    const { data } = supabase.auth.onAuthStateChange((event, s) => setSession(event === 'SIGNED_OUT' ? null : keep(s)))
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
        <span>‹ Back to {unfinished.title}</span>
        <small>
          {unfinishedSets ?? 0} {unfinishedSets === 1 ? 'set' : 'sets'} · {elapsed(unfinished.startedAt, now)}
        </small>
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
        <div key={tab} className="tab-in">
          {tab === 'routines' ? <Routines onOpen={setOpenWorkout} /> : tab === 'exercises' ? <Exercises /> : tab === 'body' ? <Body /> : <History />}
        </div>
      </main>

      {backToWorkout}

      <nav className="nav">
        <div className="nav-inner">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <span className="nav-icon">
                <t.icon />
              </span>
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
