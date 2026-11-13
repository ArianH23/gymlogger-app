import { useState } from 'react'
import { downloadHevyExport } from '../lib/exportHevy'

/** Saves your workouts as a CSV file in the format Hevy imports. */
export default function ExportHevy() {
  const [onlyApp, setOnlyApp] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const rows = await downloadHevyExport(onlyApp)
      setMessage(`Saved ${rows} sets. Look in your Downloads.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <>
      <h2>Export</h2>
      <div className="card">
        <p className="muted">A file you can load into Hevy later: your workouts, one row per set, in the format Hevy imports.</p>
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={onlyApp} className={onlyApp ? 'on' : ''} onClick={() => setOnlyApp(true)}>
            Logged here
          </button>
          <button role="tab" aria-selected={!onlyApp} className={!onlyApp ? 'on' : ''} onClick={() => setOnlyApp(false)}>
            Everything
          </button>
        </div>
        <p className="muted note">
          {onlyApp
            ? 'Only the workouts you logged in this app. Your old Hevy history is left out, because Hevy already has it.'
            : 'Also includes the Hevy history you imported. Hevy already has that: importing it back would duplicate it, unless you start from an empty account.'}
        </p>
        {error && <p className="error">{error}</p>}
        {message && <p className="muted note">{message}</p>}
        <button className="outline" disabled={busy} onClick={download}>
          {busy ? 'Preparing…' : 'Download CSV'}
        </button>
        <p className="muted note">
          In Hevy: Profile → Settings → Export &amp; Import Data → Import Data → Import Strong CSV. Hevy only reads this Strong format and allows one
          import at a time. Warm-up sets are left out (the format has no warm-up type). Hevy does not publish the format, so try it on a small file
          first.
        </p>
      </div>
    </>
  )
}
