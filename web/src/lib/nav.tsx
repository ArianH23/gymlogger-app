import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

// A tiny page stack on top of the three tabs. Each pushed page also pushes a browser history entry, so the
// phone's Back button (and the swipe-back gesture) goes back one page instead of closing the app.

export type View =
  | { type: 'exercise'; id: string }
  | { type: 'session'; id: string }
  | { type: 'exerciseForm'; id?: string } // no id = new exercise
  | { type: 'routineForm'; id?: string } // no id = new routine

type Nav = { stack: View[]; push: (v: View) => void; back: () => void }

const NavContext = createContext<Nav | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<View[]>([])

  useEffect(() => {
    history.replaceState({ depth: 0 }, '')
    const onPop = (e: PopStateEvent) => {
      const depth: number = e.state?.depth ?? 0
      setStack((s) => s.slice(0, depth))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // The browser history entry is pushed here, outside the state update: React may run updater functions twice.
  const stackRef = useRef<View[]>([])
  stackRef.current = stack

  const push = useCallback((v: View) => {
    const next = [...stackRef.current, v]
    stackRef.current = next
    history.pushState({ depth: next.length }, '')
    setStack(next)
  }, [])

  const back = useCallback(() => history.back(), [])

  const value = useMemo(() => ({ stack, push, back }), [stack, push, back])
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav() {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav must be used inside NavProvider')
  return ctx
}
