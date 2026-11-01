import { useState } from 'react'

type Tab = 'routines' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'routines', label: 'Routines' },
  { id: 'history', label: 'History' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('routines')

  return (
    <div className="app">
      <main className="screen">
        {tab === 'routines' ? (
          <>
            <h1>Routines</h1>
            <div className="card">
              <strong>Workout A, B and C will appear here.</strong>
              <p className="muted">Step 2 connects the app to your database.</p>
            </div>
          </>
        ) : (
          <>
            <h1>History</h1>
            <div className="card">
              <strong>Your past sessions will appear here.</strong>
              <p className="muted">Built after the logging screen.</p>
            </div>
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
