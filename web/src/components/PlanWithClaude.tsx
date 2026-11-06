import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { loadPlanState, requestRoutinePlan, type PlanState } from '../lib/planRequest'

type Props = {
  routineId: string
  routineName: string
  /** called when a Claude plan has arrived, so the screen can reload its plan */
  onArrived: () => void
}

/** The "Plan with Claude" button: asks first, then shows "Claude is planning…" until the new plan is in. */
export default function PlanWithClaude({ routineId, routineName, onArrived }: Props) {
  const [state, setState] = useState<PlanState>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const wasWaiting = useRef(false)
  const onArrivedRef = useRef(onArrived)
  useEffect(() => {
    onArrivedRef.current = onArrived
  })

  // the state when the screen opens, then every 10 seconds while waiting (the plan arrives a little after the request)
  useEffect(() => {
    let alive = true
    const check = () =>
      loadPlanState(routineId).then((s) => {
        if (!alive) return
        if (wasWaiting.current && s === null) onArrivedRef.current()
        wasWaiting.current = s === 'waiting'
        setState(s)
      })
    void check()
    const timer = window.setInterval(() => {
      if (wasWaiting.current) void check()
    }, 10000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [routineId])

  async function ask() {
    setAsking(false)
    setBusy(true)
    setMessage(null)
    try {
      const r = await requestRoutinePlan(routineId)
      if (r.reason === 'not_configured') setMessage('Planning with Claude is not set up yet (the secrets are missing in the database).')
      else {
        wasWaiting.current = true // also when it was asked a moment ago: it is already on its way
        setState('waiting')
        if (r.reason === 'recent') setMessage('Already asked a moment ago.')
      }
    } catch {
      setMessage('Could not ask Claude: no signal? Try again when you are back online.')
    }
    setBusy(false)
  }

  const waiting = state === 'waiting'
  return (
    <div className="plan-claude">
      <button className="outline" disabled={busy || waiting} onClick={() => setAsking(true)}>
        {waiting ? 'Claude is planning…' : busy ? 'Asking…' : 'Plan with Claude'}
      </button>
      {waiting && <p className="muted note">Asked just now. The new plan shows up here by itself.</p>}
      {state === 'no_answer' && !waiting && <p className="muted note">No answer from Claude yet. You can ask again.</p>}
      {message && <p className="muted note">{message}</p>}
      {asking && (
        <ConfirmDialog title={`Plan ${routineName} with Claude?`} confirmLabel="Yes, plan it" onConfirm={ask} onCancel={() => setAsking(false)}>
          <p>
            Claude will read your recent sessions and check-ins and write a new plan for {routineName}. It replaces the plan you have now. It takes a
            little while, and you can keep using the app meanwhile.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
