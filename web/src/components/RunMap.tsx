import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { TrackPoint } from '../lib/runs'

/**
 * The route on a real map (OpenStreetMap tiles). Only the tiles of the area on screen are requested, as the tile rules
 * ask: nothing is downloaded ahead. The GPS points themselves never leave the phone; the map server only sees which
 * tiles are asked for, which is roughly the area of the run.
 */
export default function RunMap({ track }: { track: TrackPoint[] }) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const latlngs = track.filter((p): p is TrackPoint & { lat: number; lon: number } => p.lat !== null && p.lon !== null).map((p) => [p.lat, p.lon] as L.LatLngTuple)
    if (latlngs.length < 2) return

    const map = L.map(el, { zoomControl: true, attributionControl: false, scrollWheelZoom: false, tap: false } as L.MapOptions)
    L.control.attribution({ prefix: false }).addTo(map) // only the map data credit, which the tile rules require to be visible
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map)

    const line = L.polyline(latlngs, { color: '#45c08a', weight: 4, opacity: 0.95, lineJoin: 'round' }).addTo(map)
    const dot = (at: L.LatLngTuple, fill: string) => L.circleMarker(at, { radius: 7, color: '#131715', weight: 2, fillColor: fill, fillOpacity: 1 }).addTo(map)
    dot(latlngs[0], '#45c08a') // start
    dot(latlngs[latlngs.length - 1], '#c8a45c') // finish
    map.fitBounds(line.getBounds(), { padding: [24, 24] })

    return () => {
      map.remove()
    }
  }, [track])

  return <div ref={box} className="run-map" role="img" aria-label="The route of the run on a map, from start to finish" />
}
