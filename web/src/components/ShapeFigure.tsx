import { useId, useMemo } from 'react'
import { buildFigure, VIEW_CROP_W, VIEW_H, VIEW_X, type Dims } from '../lib/shapeGeometry'
import { REGIONS } from '../lib/shape'

// Two figures on top of each other: you (filled blue) and the target (orange tint and outline). Colours are the
// validated categorical pair for a dark surface; the fill-versus-outline difference means colour is never the only cue.
const YOU = '#3987e5'
const TARGET = '#d95926'
// the arms stand a little away from the body, as in a relaxed athletic pose, so the waist and the V of the torso can be seen
const ARM_SPREAD_CM = 9

type Props = {
  you: Dims
  target: Dims
  heightCm: number
  selected: string | null // a region key
  onSelect: (key: string) => void
}

/** The front-view figure. Tap a part of the body to select it (the table below lists the same numbers). */
export default function ShapeFigure({ you, target, heightCm, selected, onSelect }: Props) {
  const id = useId().replace(/:/g, '')
  const yours = useMemo(() => buildFigure(you, heightCm, { armSpread: ARM_SPREAD_CM }), [you, heightCm])
  const goal = useMemo(() => buildFigure(target, heightCm, { armSpread: ARM_SPREAD_CM }), [target, heightCm])
  const { y, cx, half } = yours
  const torsoHalf = Math.max(half.chest, half.hips) * 0.85
  const sel = REGIONS.find((r) => r.key === selected)

  const group = (fig: typeof yours) => (
    <>
      {fig.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <ellipse cx={fig.head.cx} cy={fig.head.cy} rx={fig.head.rx} ry={fig.head.ry} />
    </>
  )

  // tap zones: the torso regions across the middle, arms on the outer strips, legs below (arms are drawn last so they win)
  const zone = (key: string, x: number, w: number, label: string) => {
    const r = REGIONS.find((q) => q.key === key)!
    const top = y(r.y[1])
    return (
      <rect
        key={`${key}-${x}`}
        x={x}
        y={top}
        width={w}
        height={y(r.y[0]) - top}
        fill="transparent"
        role="button"
        tabIndex={0}
        aria-label={label}
        style={{ cursor: 'pointer' }}
        onClick={() => onSelect(key)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(key)}
      />
    )
  }

  return (
    <svg className="shape-fig" viewBox={`${VIEW_X} 0 ${VIEW_CROP_W} ${VIEW_H}`} role="group" aria-label="Front view of your shape against the target">
      <defs>
        {/* only the outer edge of the target shape, so overlapping limbs do not draw lines inside */}
        <filter id={`edge-${id}`} x="-5%" y="-5%" width="110%" height="110%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="2.5" result="grown" />
          <feComposite in="grown" in2="SourceAlpha" operator="out" result="edge" />
          <feFlood floodColor={TARGET} />
          <feComposite in2="edge" operator="in" />
        </filter>
      </defs>

      {sel && <rect x={VIEW_X} y={y(sel.y[1])} width={VIEW_CROP_W} height={y(sel.y[0]) - y(sel.y[1])} fill="#ffffff" opacity="0.08" />}
      <line x1={VIEW_X + 20} y1={y(0) + 6} x2={VIEW_X + VIEW_CROP_W - 20} y2={y(0) + 6} stroke="#2c2f38" strokeWidth="2" />

      <g fill={TARGET} opacity="0.22">{group(goal)}</g>
      <g fill={YOU} opacity="0.85">{group(yours)}</g>
      <g fill="#000" filter={`url(#edge-${id})`}>{group(goal)}</g>

      {sel && (
        <>
          <line x1={VIEW_X} y1={y(sel.y[1])} x2={VIEW_X + 24} y2={y(sel.y[1])} stroke="#fff" strokeWidth="2" />
          <line x1={VIEW_X} y1={y(sel.y[0])} x2={VIEW_X + 24} y2={y(sel.y[0])} stroke="#fff" strokeWidth="2" />
        </>
      )}

      {zone('neck', cx - half.shoulders * 0.3, half.shoulders * 0.6, 'Neck')}
      {zone('shoulders', cx - half.shoulders * 1.05, half.shoulders * 2.1, 'Shoulders')}
      {zone('chest', cx - torsoHalf, torsoHalf * 2, 'Chest')}
      {zone('waist', cx - torsoHalf, torsoHalf * 2, 'Waist')}
      {zone('abdomen', cx - torsoHalf, torsoHalf * 2, 'Abdomen')}
      {zone('hips', cx - torsoHalf, torsoHalf * 2, 'Hips')}
      {zone('thighs', cx - half.hips * 1.1, half.hips * 2.2, 'Thighs')}
      {zone('calves', cx - half.hips * 0.9, half.hips * 1.8, 'Calves')}
      {(['biceps', 'forearms'] as const).map((k) => (
        <g key={k}>
          {zone(k, cx - half.shoulders * 1.6, half.shoulders * 1.6 - torsoHalf, `Left ${k}`)}
          {zone(k, cx + torsoHalf, half.shoulders * 1.6 - torsoHalf, `Right ${k}`)}
        </g>
      ))}
    </svg>
  )
}
