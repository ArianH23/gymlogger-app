import type { ReactNode } from 'react'
import { useNav } from '../lib/nav'

/** Full-screen page with a Back button. Used for exercise and session pages. */
export function Page({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const { back } = useNav()
  return (
    <div className="app">
      <main className="screen">
        <div className="page-bar">
          <button className="link" onClick={back}>
            ‹ Back
          </button>
          {action}
        </div>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  )
}
