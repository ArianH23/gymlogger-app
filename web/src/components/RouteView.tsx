import { lazy, Suspense, useEffect, useState } from 'react'
import RouteLine from './RouteLine'
import type { TrackPoint } from '../lib/runs'

// The map (and its library) is loaded only when a run page with a route is opened.
const RunMap = lazy(() => import('./RunMap'))

/**
 * The route of a run on a real map. With no signal, or if the map cannot load, it falls back to the plain line,
 * which needs nothing from outside. "Line only" is always a tap away.
 */
export default function RouteView({ track }: { track: TrackPoint[] }) {
  const [online, setOnline] = useState(navigator.onLine)
  const [lineOnly, setLineOnly] = useState(false)
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
  return (
    <>
      <Suspense fallback={<RouteLine track={track} />}>
        <RunMap track={track} />
      </Suspense>
      <button className="link map-toggle" onClick={() => setLineOnly(true)}>
        Line only
      </button>
    </>
  )
}
