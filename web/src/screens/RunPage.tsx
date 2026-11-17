import { useEffect, useMemo, useState } from 'react'
import { Page } from '../components/Page'
import { PageSkeleton } from '../components/Skeleton'
import ConfirmDialog from '../components/ConfirmDialog'
import RouteView from '../components/RouteView'
import ProfileChart from '../components/ProfileChart'
import PaceClimbChart from '../components/PaceClimbChart'
import { pacePieces } from '../lib/paceClimb'
import SplitList from '../components/SplitList'
import { useNav } from '../lib/nav'
import { formatDate } from '../lib/format'
import { deleteRun, formatDuration, formatKm, formatPace, loadRun, updateRun, type RunDetail } from '../lib/runs'

const SOURCES: Record<string, string> = { strava_import: 'from Strava', google_health: 'from Google Health', tcx_file: 'from a TCX file' }

/** One run: the numbers, the route, the pace of each kilometre, and altitude and heart rate along the way. */
export default function RunPage({ id }: { id: string }) {
  const { back } = useNav()
  const [data, setData] = useState<RunDetail | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    loadRun(id)
      .then((r) => {
        setData(r.detail)
        setOffline(r.offline)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [id])

  const run = data?.run
  const altitude = useMemo(() => (data?.track ?? []).filter((p) => p.alt !== null).map((p) => ({ x: p.d / 1000, y: p.alt as number })), [data])
  // with altitude and times along the route, altitude is shown together with the pace; otherwise on its own
  const pacedAltitude = useMemo(() => {
    const p = pacePieces(data?.track ?? [])
    return p.length >= 5 && p.filter((q) => q.alt !== null).length >= 5
  }, [data])
  const heart = useMemo(() => (data?.track ?? []).filter((p) => p.hr !== null).map((p) => ({ x: p.d / 1000, y: p.hr as number })), [data])
  // When the GPS did not work the database assumes a steady pace, so every full kilometre takes the same time.
  const fullSplits = (data?.splits ?? []).filter((s) => s.distanceM >= 999.5)
  const evenPace = fullSplits.length > 1 && Math.max(...fullSplits.map((s) => s.seconds)) - Math.min(...fullSplits.map((s) => s.seconds)) < 1

  async function save() {
    if (!run) return
    if (!title.trim()) return setError('Give the run a name.')
    setBusy(true)
    setError(null)
    try {
      await updateRun(run.id, title.trim(), notes.trim() || null)
      setData((d) => (d ? { ...d, run: { ...d.run, title: title.trim(), notes: notes.trim() || null } } : d))
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  async function remove() {
    setAsking(false)
    setBusy(true)
    try {
      await deleteRun(id)
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Page
      title={run?.title ?? 'Run'}
      action={
        run &&
        !editing && (
          <button
            className="link edit-link"
            onClick={() => {
              setTitle(run.title)
              setNotes(run.notes ?? '')
              setEditing(true)
            }}
          >
            Edit
          </button>
        )
      }
    >
      {error && <div className="card error">{error}</div>}
      {!data && !error && <PageSkeleton />}
      {offline && <p className="muted">No signal: showing the last copy saved on this phone.</p>}
      {data && run && (
        <>
          <p className="muted subtitle">
            {formatDate(run.startedAt)} · {SOURCES[run.source] ?? run.source}
          </p>

          {editing && (
            <div className="card">
              <label>
                Name
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                Notes
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="how it felt, shoes, weather…" />
              </label>
              <button className="primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button className="link" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          )}

          <div className="stat-row">
            <div className="stat">
              <div className="stat-value">
                {formatKm(run.distanceKm)} <small>km</small>
              </div>
              <div className="muted">distance</div>
            </div>
            <div className="stat">
              <div className="stat-value">{formatDuration(run.movingS)}</div>
              <div className="muted">time</div>
            </div>
            <div className="stat">
              <div className="stat-value">
                {formatPace(run.paceSPerKm)} <small>/km</small>
              </div>
              <div className="muted">pace</div>
            </div>
          </div>

          <div className="card table run-facts">
            {run.elapsedS - run.movingS >= 10 && (
              <div className="table-row">
                <span>Elapsed, with pauses</span>
                <span>{formatDuration(run.elapsedS)}</span>
              </div>
            )}
            {run.elevationGainM !== null && (
              <div className="table-row">
                <span>Climbed</span>
                <span>{Math.round(run.elevationGainM)} m</span>
              </div>
            )}
            {run.avgHr !== null && (
              <div className="table-row">
                <span>Heart rate, average</span>
                <span>{run.avgHr} bpm</span>
              </div>
            )}
            {run.maxHr !== null && (
              <div className="table-row">
                <span>Heart rate, highest</span>
                <span>{run.maxHr} bpm</span>
              </div>
            )}
            {run.calories !== null && (
              <div className="table-row">
                <span>Calories</span>
                <span>{run.calories} kcal</span>
              </div>
            )}
          </div>

          {run.notes && !editing && <p className="card note-card">“{run.notes}”</p>}

          <h2>Route</h2>
          <div className="card">
            <RouteView track={data.track} splits={data.splits} />
          </div>

          {data.splits.length > 0 && (
            <>
              <h2>Each kilometre</h2>
              <div className="card">
                <SplitList splits={data.splits} />
                <p className="muted note">
                  {evenPace
                    ? 'The GPS did not work on this run, so the distance is the one the watch reported and the pace is the average for every kilometre.'
                    : 'Pace per kilometre from moving time. A longer bar is a faster kilometre.'}
                </p>
              </div>
            </>
          )}

          {altitude.length > 1 && (
            <>
              <h2>{pacedAltitude ? 'Pace and climb' : 'Altitude'}</h2>
              <div className="card">
                {pacedAltitude ? (
                  <PaceClimbChart track={data.track} />
                ) : (
                  <ProfileChart points={altitude} color="var(--chart)" label="Altitude" unit="m" />
                )}
              </div>
            </>
          )}

          {heart.length > 1 && (
            <>
              <h2>Heart rate</h2>
              <div className="card">
                <ProfileChart points={heart} color="var(--target)" label="Heart rate" unit="bpm" />
              </div>
            </>
          )}

          <button className="link danger" disabled={busy} onClick={() => setAsking(true)}>
            Delete run
          </button>
          {asking && (
            <ConfirmDialog title="Delete this run?" confirmLabel="Delete" onConfirm={remove} onCancel={() => setAsking(false)}>
              <p>It leaves your history, calendar and bests. Importing the same file again brings it back.</p>
            </ConfirmDialog>
          )}
        </>
      )}
    </Page>
  )
}
