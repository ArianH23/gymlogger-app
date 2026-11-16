import type { BalanceRow } from '../lib/muscles'
import { num } from '../lib/format'

/**
 * Two sides of the body against each other (push against pull, front against back, upper against lower, quads against
 * hamstrings): one bar per comparison, split where the two sides meet, with a tick at the even point.
 * The sides are named and counted at the two ends, so the colours are not needed to read it.
 */
export default function BalanceBars({ rows }: { rows: BalanceRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="balance">
      <h3>Balance</h3>
      <ul>
        {rows.map((r) => {
          const a = Math.round(r.aShare * 100)
          return (
            <li key={r.pair}>
              <div className="bal-ends">
                <span>
                  {r.aLabel} {num(r.aSets)} <small className="muted">{a}%</small>
                </span>
                <span>
                  <small className="muted">{100 - a}%</small> {num(r.bSets)} {r.bLabel}
                </span>
              </div>
              <div className="bal-track" role="img" aria-label={`${r.label}: ${r.aLabel} ${num(r.aSets)} sets (${a}%), ${r.bLabel} ${num(r.bSets)} sets (${100 - a}%)`}>
                {r.aSets > 0 && <span className={`bal-a${r.bSets > 0 ? '' : ' only'}`} style={{ width: `${r.aShare * 100}%` }} />}
                {r.bSets > 0 && <span className={`bal-b${r.aSets > 0 ? '' : ' only'}`} />}
                <span className="bal-mid" aria-hidden="true" />
              </div>
            </li>
          )
        })}
      </ul>
      <p className="muted note">The tick marks an even split. It is a comparison, not a target: a muscle on neither side is left out.</p>
    </div>
  )
}
