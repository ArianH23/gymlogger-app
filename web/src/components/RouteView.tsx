import { lazy, Suspense, useEffect, useState } from 'react'
import RouteLine from './RouteLine'
import { formatPace, type RunSplit, type TrackPoint } from '../lib/runs'
import { paceRange } from '../lib/routePace'

// The map (and its library) is loaded only when a run page with a route is opened.
const RunMap = lazy(() => import('./RunMap'))

/**
 * The route of a run on a real map. With no signal, or if the map cannot load, it falls back to the plain line,
 * which needs nothing from outside. "Line only" is always a tap away.
 */
export default function RouteView({ track, splits }: { track: TrackPoint[]; splits: RunSplit[] }) {
  const [online, setOnline] = useState(navigator.onLine)
  const [lineOnly, setLineOnly] = useState(false)
  const [byPace, setByPace] = useState(true) // each kilometre in a colour from its pace
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const hasRoute = track.filter((p) => p.lat !== null && p.lon !== null).length >= 2
  if (!hasRoute || !online || lineOnly) {
    return (
      <>
        <RouteLine track={track} />
        {hasRoute && online && (
          <button className="link map-toggle" onClick={() => setLineOnly(false)}>
            Show the map
          </button>
        )}
        {hasRoute && !online && <p className="muted note">No signal: showing the line without the map.</p>}
      </>
    )
  }
  const range = paceRange(splits)
  return (
    <>
      <Suspense fallback={<RouteLine track={track} />}>
        <RunMap track={track} splits={splits} byPace={byPace} />
      </Suspense>
      {byPace && range && (
        <div className="pace-legend" aria-label={`Colour by pace: slowest kilometre ${formatPace(range.slowest)}, fastest ${formatPace(range.fastest)} per km`}>
          <span>{formatPace(range.slowest)}</span>
          <i className="pace-bar" />
          <span>{formatPace(range.fastest)}</span>
          <small className="muted">per km, slow to fast · the numbers mark each kilometre</small>
        </div>
      )}
      <div className="map-toggles">
        <button className="link map-toggle" onClick={() => setByPace(!byPace)}>
          {byPace ? 'Plain colour' : 'Colour by pace'}
        </button>
        <button className="link map-toggle" onClick={() => setLineOnly(true)}>
          Line only
        </button>
      </div>
    </>
  )
}
