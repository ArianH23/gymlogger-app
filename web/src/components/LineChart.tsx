import { useEffect, useMemo, useRef, useState } from 'react'

// One series over time. Specs follow the dataviz guidance: 2px line, ~10% area wash, >=8px markers with a
// 2px surface ring, hairline solid grid, round y ticks, labels only on the best and the latest point,
// pointer/touch scrubbing that snaps to the nearest point (the hit target is the whole plot, not the dots).

export type Point = { t: number; v: number }

type Props = {
  points: Point[] // sorted by time
  selected: number | null
  onSelect: (index: number) => void
  formatValue: (v: number) => string // for the two direct labels
  formatTick: (v: number) => string // for the y axis
  lowerIsBetter?: boolean // assisted exercises: the "best" point is the lowest
  ariaLabel: string
  height?: number
}

const M = { left: 44, right: 14, top: 26, bottom: 26 }

/** Round tick values: 1, 2, 5 x 10^n steps. */
function niceScale(min: number, max: number, target = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    min -= pad
    max += pad
  }
  const raw = (max - min) / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)))
  return { lo, hi, ticks }
}

const axisDate = (t: number, spanMs: number) =>
  new Date(t).toLocaleDateString('en-GB', spanMs > 300 * 86400000 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' })

export default function LineChart({ points, selected, onSelect, formatValue, formatTick, lowerIsBetter, ariaLabel, height = 240 }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    const values = points.map((p) => p.v)
    const { lo, hi, ticks } = niceScale(Math.min(...values), Math.max(...values))
    const t0 = points[0].t
    const t1 = points[points.length - 1].t
    const span = Math.max(t1 - t0, 1)
    const plotW = Math.max(width - M.left - M.right, 1) // 0 wide while hidden: no negative size
    const plotH = height - M.top - M.bottom
    const x = (t: number) => (points.length === 1 ? M.left + plotW / 2 : M.left + ((t - t0) / span) * plotW)
    const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * plotH
    const best = values.reduce((bi, v, i) => ((lowerIsBetter ? v < values[bi] : v > values[bi]) ? i : bi), 0)
    return { ticks, x, y, plotW, plotH, t0, t1, span, best }
  }, [points, width, height, lowerIsBetter])

  // A long pause in training is a gap, not a slow slide: don't draw a line across more than 90 days.
  const GAP = 90 * 86400000
  const runs: Point[][] = []
  points.forEach((p, i) => {
    if (i === 0 || p.t - points[i - 1].t > GAP) runs.push([p])
    else runs[runs.length - 1].push(p)
  })
  const baseY = M.top + geo.plotH
  const path = (run: Point[]) => run.map((p, i) => `${i ? 'L' : 'M'}${geo.x(p.t).toFixed(1)} ${geo.y(p.v).toFixed(1)}`).join(' ')
  const line = runs.map(path).join(' ')
  const area = runs
    .filter((r) => r.length > 1)
    .map((r) => `${path(r)} L${geo.x(r[r.length - 1].t).toFixed(1)} ${baseY} L${geo.x(r[0].t).toFixed(1)} ${baseY} Z`)
    .join(' ')
  const showAllMarkers = points.length <= 40
  const last = points.length - 1

  function pick(clientX: number) {
    const rect = wrap.current!.getBoundingClientRect()
    const px = clientX - rect.left
    let nearest = 0
    let dist = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(geo.x(p.t) - px)
      if (d < dist) {
        dist = d
        nearest = i
      }
    })
    onSelect(nearest)
  }

  const xTicks = points.length === 1 ? [points[0].t] : [0, 1 / 3, 2 / 3, 1].map((f) => geo.t0 + f * geo.span)
  const label = (i: number) => {
    const px = geo.x(points[i].t)
    const anchor: 'start' | 'middle' | 'end' = px < M.left + 24 ? 'start' : px > width - M.right - 24 ? 'end' : 'middle'
    return { px, py: geo.y(points[i].v) - 10, anchor }
  }
  const labelled = last === geo.best ? [last] : [geo.best, last]

  return (
    <div ref={wrap} className="chart" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {/* hairline grid + y labels */}
        {geo.ticks.map((tv) => (
          <g key={tv}>
            <line x1={M.left} x2={width - M.right} y1={geo.y(tv)} y2={geo.y(tv)} className="chart-grid" />
            <text x={M.left - 8} y={geo.y(tv)} className="chart-axis" textAnchor="end" dominantBaseline="middle">
              {formatTick(tv)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={t}
            x={geo.x(t)}
            y={height - 6}
            className="chart-axis"
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 && points.length > 1 ? 'end' : 'middle'}
          >
            {axisDate(t, geo.span)}
          </text>
        ))}

        <path d={area} className="chart-area" />
        <path d={line} className="chart-line" />

        {points.map((p, i) =>
          showAllMarkers || i === last || i === geo.best || i === selected ? (
            <circle key={p.t + ':' + i} cx={geo.x(p.t)} cy={geo.y(p.v)} r={i === selected ? 6 : 4} className="chart-dot" />
          ) : null,
        )}

        {selected !== null && (
          <line x1={geo.x(points[selected].t)} x2={geo.x(points[selected].t)} y1={M.top} y2={baseY} className="chart-cross" />
        )}

        {labelled.map((i) => {
          const l = label(i)
          return (
            <text key={'l' + i} x={l.px} y={l.py} textAnchor={l.anchor} className="chart-label">
              {formatValue(points[i].v)}
            </text>
          )
        })}

        {/* the whole plot is the touch target */}
        <rect
          x={M.left}
          y={0}
          width={geo.plotW}
          height={height}
          fill="transparent"
          style={{ touchAction: 'pan-y' }}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerMove={(e) => (e.buttons > 0 || e.pointerType === 'mouse') && pick(e.clientX)}
        />
      </svg>
    </div>
  )
}
