import { useEffect, useMemo, useState } from 'react'
import { Page } from '../components/Page'
import ShapeFigure from '../components/ShapeFigure'
import { useNav } from '../lib/nav'
import { dimsFor, loadShape, regionStats, type RegionStat, type ShapeData } from '../lib/shape'
import { formatDate, num } from '../lib/format'

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`
const pct = (c: number) => `${Math.round(c * 100)}%`

/** What is left to do for one region, in words. */
const toDo = (s: RegionStat) => {
  if (s.gap === null || s.current === null) return 'not measured yet'
  if (Math.abs(s.gap) < 0.5) return 'on target'
  if ((s.kind === 'grow') !== s.gap > 0) return `${num(Math.abs(s.gap))} cm past the target, nothing to do`
  return s.gap > 0 ? `${num(s.gap)} cm to grow` : `${num(Math.abs(s.gap))} cm to shrink`
}

/** Your measurements as a figure over the target figure, with the gap for each part of the body. */
export default function ShapePage() {
  const { push } = useNav()
  const [data, setData] = useState<(ShapeData & { offline: boolean }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    loadShape()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e?.message ?? e)))
  }, [])

  const stats = useMemo(() => (data ? regionStats(data) : []), [data])
  const chosen = stats.find((s) => s.region.key === selected)

  const latestOn = data?.rows.map((r) => r.latestOn).sort().at(-1)
  const shoulders = stats.find((s) => s.region.key === 'shoulders')
  const waist = stats.find((s) => s.region.key === 'waist')
  const taper = shoulders?.current && waist?.current ? shoulders.current / waist.current : null
  const taperTarget = shoulders?.target && waist?.target ? shoulders.target / waist.target : null

  return (
    <Page title="Shape vs target">
      {error && <div className="card error">Could not load: {error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data?.offline && <p className="muted">No signal: showing the last copy saved on this phone.</p>}

      {data && data.heightCm === null && (
        <div className="card">
          <p>The target is built from your height, so add it first (Body tab, under Measurements).</p>
        </div>
      )}

      {data && data.heightCm !== null && (
        <>
          {data.rows.length === 0 && <p className="muted">No tape measurements yet: the figure shows the target only. Log a check-in with some circumferences.</p>}
          <div className="card shape-card">
            <ShapeFigure you={dimsFor(data, 'you')} target={dimsFor(data, 'target')} heightCm={data.heightCm} selected={selected} onSelect={(k) => setSelected((s) => (s === k ? null : k))} />
            <div className="shape-legend">
              <span>
                <i className="swatch you" /> You{latestOn ? `, ${formatDate(`${latestOn}T12:00:00`)}` : ''}
              </span>
              <span>
                <i className="swatch target" /> Target
              </span>
            </div>
          </div>

          {chosen ? (
            <div className="card">
              <div className="shape-detail-head">
                <strong>{chosen.region.label}</strong>
                <button className="link" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
              {chosen.measured.length === 0 ? (
                <p className="muted">Not measured yet. Target {chosen.target === null ? '–' : `${num(chosen.target)} cm`}.</p>
              ) : (
                <>
                  <p>
                    You {chosen.measured.map((r) => num(r.current)).join(' / ')} cm · target {num(chosen.target ?? 0)} cm · {toDo(chosen)}
                  </p>
                  {chosen.measured.length > 1 && <p className="muted note">Left / right, as measured. The figure and the gap use the average.</p>}
                </>
              )}
            </div>
          ) : (
            <p className="muted note">Tap a part of the body, or a row below, for its numbers.</p>
          )}

          <h2>Gaps</h2>
          <div className="card table gaps">
            <div className="table-row head">
              <span>Part</span>
              <span>You → target</span>
              <span>Closeness</span>
            </div>
            {stats.map((s) => (
              <button className={`table-row gap-row${s.region.key === selected ? ' on' : ''}`} key={s.region.key} onClick={() => setSelected(s.region.key)}>
                <span>{s.region.label}</span>
                <span>
                  {s.current === null ? '–' : num(s.current)} → {s.target === null ? '–' : num(s.target)}
                  <small className="muted"> {s.gap === null ? '' : `${signed(s.gap)} cm`}</small>
                </span>
                <span className="bar-cell">
                  {s.closeness === null ? (
                    <span className="muted">–</span>
                  ) : (
                    <>
                      <span className="bar" role="img" aria-label={`${pct(s.closeness)} of the way`}>
                        <span className="bar-fill" style={{ width: pct(s.closeness) }} />
                      </span>
                      <span className="bar-num">{pct(s.closeness)}</span>
                    </>
                  )}
                </span>
              </button>
            ))}
            {taper !== null && taperTarget !== null && (
              <div className="table-row taper-row">
                <span>V-taper (shoulders ÷ waist)</span>
                <span>
                  {taper.toFixed(2)} → {taperTarget.toFixed(2)}
                </span>
                <span className="bar-cell">
                  <span className="bar" role="img" aria-label={`${pct(Math.min(taper / taperTarget, 1))} of the way`}>
                    <span className="bar-fill" style={{ width: pct(Math.min(taper / taperTarget, 1)) }} />
                  </span>
                  <span className="bar-num">{pct(Math.min(taper / taperTarget, 1))}</span>
                </span>
              </div>
            )}
          </div>

          <button className="outline" onClick={() => push({ type: 'shapeTargets' })}>
            Edit targets
          </button>
          <p className="muted note">
            The target is a model, not anyone’s real numbers (nobody has them): a lean, muscular build with a wide V-taper, worked out as shares of your
            height (shoulders 72%, waist 44%, thighs 34%…). A part you grow is closer the nearer you are to its target; a part you shrink (waist,
            abdomen) is judged the other way round. Closeness is capped at 100%. Edit any target to match your own plan.
          </p>
        </>
      )}
    </Page>
  )
}
