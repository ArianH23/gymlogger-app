import { useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { parseTcx, type ParsedRun } from '../lib/tcx'
import { formatDuration, submitRun } from '../lib/runs'
import { formatDate } from '../lib/format'

/** "Import run": pick the TCX file exported from Google Health, check what was read, and save it. */
export default function RunImport({ onImported }: { onImported: (runId: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function picked(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      setParsed(parseTcx(await file.text()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    }
    if (input.current) input.current.value = '' // so the same file can be picked again
  }

  async function save() {
    if (!parsed) return
    const run = parsed
    setParsed(null)
    setBusy(true)
    try {
      const { runId } = await submitRun(run.payload)
      onImported(runId)
    } catch (e) {
      setError(e instanceof Error ? `Could not save the run: ${e.message}` : 'Could not save the run.')
    }
    setBusy(false)
  }

  const p = parsed?.payload
  return (
    <div className="run-import">
      <input ref={input} type="file" accept=".tcx,application/xml,text/xml,application/vnd.garmin.tcx+xml" hidden onChange={(e) => picked(e.target.files?.[0])} />
      <button className="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Saving the run…' : '+ Import run'}
      </button>
      {error && <p className="error note">{error}</p>}
      <p className="muted note">In Google Health: Fitness, open the run, More, Export. Then pick that file here.</p>
      {parsed && p && (
        <ConfirmDialog title="Import this run?" confirmLabel="Import" onConfirm={save} onCancel={() => setParsed(null)}>
          <p>
            <strong>{formatDate(p.started_at)}</strong>
          </p>
          <p>
            {p.distance_m ? `${(p.distance_m / 1000).toFixed(2)} km` : 'Distance from the GPS track'}
            {p.elapsed_s ? ` · ${formatDuration(p.elapsed_s)}` : ''} · {p.points.length} points
          </p>
          <p>
            {parsed.device ?? 'Unknown device'} · {parsed.hasHeartRate ? 'with heart rate' : 'no heart rate'}
            {parsed.hasPositions ? '' : ' · no GPS positions'}
          </p>
          {parsed.sport !== 'Running' && <p className="error">This file says “{parsed.sport}”, not a run.</p>}
          <p className="note">If this run is already here (for example from Strava), it is updated, not added twice.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
