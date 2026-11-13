import type { ReactNode } from 'react'

// Grey placeholder shapes shown while a screen loads, laid out like the real thing so nothing jumps when the data arrives.
// They shimmer, except for people who asked their phone for less motion. Screen readers hear "Loading…".

type BlockProps = { w?: number | string; h?: number; r?: number }

/** One placeholder bar or block. */
export function Skeleton({ w = '100%', h = 16, r }: BlockProps) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />
}

function Wrap({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  )
}

/** A list of cards with a title and a second line (routines, exercises, history). `button` adds the big Start button. */
export function ListSkeleton({ rows = 4, button = false }: { rows?: number; button?: boolean }) {
  return (
    <Wrap>
      {Array.from({ length: rows }, (_, i) => (
        <div className="card skel-card" key={i}>
          <Skeleton w="55%" h={20} />
          <Skeleton w="80%" h={14} />
          {button && <Skeleton h={52} r={14} />}
        </div>
      ))}
    </Wrap>
  )
}

/** A detail page: three stat tiles, then a few cards with table rows (session, routine, exercise). */
export function PageSkeleton() {
  return (
    <Wrap>
      <div className="stat-row">
        {[0, 1, 2].map((i) => (
          <div className="stat skel-card" key={i}>
            <Skeleton w="60%" h={26} />
            <Skeleton w="45%" h={14} />
          </div>
        ))}
      </div>
      {[0, 1].map((i) => (
        <div className="card skel-card" key={i}>
          <Skeleton w="50%" h={20} />
          <Skeleton h={14} />
          <Skeleton h={14} />
          <Skeleton w="70%" h={14} />
        </div>
      ))}
    </Wrap>
  )
}

/** A form card: a label and an input per field. */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <Wrap>
      <div className="card skel-card">
        {Array.from({ length: fields }, (_, i) => (
          <div className="skel-card" key={i}>
            <Skeleton w="35%" h={14} />
            <Skeleton h={46} r={12} />
          </div>
        ))}
      </div>
    </Wrap>
  )
}

/** A card with a big block in it (a chart or a figure). */
export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <Wrap>
      <div className="card skel-card">
        <Skeleton w="40%" h={20} />
        <Skeleton h={height} r={12} />
      </div>
    </Wrap>
  )
}
