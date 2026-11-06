// A schematic front-view figure built from tape measurements (cm). It shows proportions and gaps, not a scan:
//  - trunk circumferences become widths with fixed factors, limbs are treated as circles (width = circumference / pi),
//  - the heights of the landmarks (shoulders, chest, waist...) are typical proportions of body height.

export const VIEW_W = 600
export const VIEW_H = 780
/** The part of the canvas that is shown: the figure is centred, so the empty sides are cropped. */
export const VIEW_X = 120
export const VIEW_CROP_W = 360
const FLOOR = 750
const CX = VIEW_W / 2

/** The measurements one figure needs, in cm. */
export type Dims = {
  shoulders: number
  chest: number
  waist: number
  abdomen: number
  hips: number
  neck: number
  bicep_l: number
  bicep_r: number
  forearm_l: number
  forearm_r: number
  thigh_l: number
  thigh_r: number
  calf_l: number
  calf_r: number
}

type Pt = [number, number]

/** A smooth closed path through the points (Catmull-Rom turned into Bezier curves). */
function smoothClosed(pts: Pt[]): string {
  const n = pts.length
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d + ' Z'
}

export type Figure = {
  paths: string[] // body, arms and legs
  head: { cx: number; cy: number; rx: number; ry: number }
  /** vertical pixel of a landmark given as a fraction of body height (0 = floor, 1 = top of the head) */
  y: (frac: number) => number
  /** pixels per cm */
  px: number
  /** half widths (px) the zones and highlights can use */
  half: { shoulders: number; chest: number; hips: number }
  cx: number
}

export function buildFigure(m: Dims, heightCm: number): Figure {
  const px = (FLOOR - 24) / heightCm // the figure always fills the same height
  const y = (frac: number) => FLOOR - frac * heightCm * px

  const sh = (0.385 * m.shoulders) / 2 // half width across the deltoids
  const ch = (0.31 * m.chest) / 2
  const wa = (0.31 * m.waist) / 2
  const ab = (0.31 * m.abdomen) / 2
  const hi = (0.31 * m.hips) / 2
  const nk = m.neck / Math.PI / 2

  // [height fraction, half width in cm] from the neck down to the pelvis
  const left: [number, number][] = [
    [0.87, nk],
    [0.84, nk + 2.5],
    [0.815, sh * 0.93],
    [0.785, sh * 0.9],
    [0.735, ch],
    [0.685, ch + (wa - ch) * 0.5],
    [0.625, wa],
    [0.595, ab],
    [0.53, hi],
    [0.485, hi * 0.97],
  ]
  const torso: Pt[] = [
    ...left.map(([f, hw]): Pt => [CX - hw * px, y(f)]),
    ...[...left].reverse().map(([f, hw]): Pt => [CX + hw * px, y(f)]),
  ]
  const paths = [smoothClosed(torso)]

  // a limb from top to bottom: [height fraction, half width cm, sideways drift cm]
  const limb = (centreCm: number, spec: [number, number, number][]): Pt[] => [
    ...spec.map(([f, hw, off]): Pt => [CX + (centreCm + off) * px - hw * px, y(f)]),
    ...[...spec].reverse().map(([f, hw, off]): Pt => [CX + (centreCm + off) * px + hw * px, y(f)]),
  ]

  for (const side of ['l', 'r'] as const) {
    const sign = side === 'l' ? -1 : 1
    const bw = m[side === 'l' ? 'bicep_l' : 'bicep_r'] / Math.PI / 2
    const fw = m[side === 'l' ? 'forearm_l' : 'forearm_r'] / Math.PI / 2
    const armX = sign * (sh - bw * 0.95)
    paths.push(
      smoothClosed(
        limb(armX, [
          [0.81, bw * 0.8, 0],
          [0.74, bw, sign * 0.4],
          [0.665, ((bw + fw) / 2) * 0.95, sign * 0.9],
          [0.57, fw, sign * 1.5],
          [0.5, fw * 0.62, sign * 2.0],
          [0.455, 2.6, sign * 2.2],
        ]),
      ),
    )
    const tw = m[side === 'l' ? 'thigh_l' : 'thigh_r'] / Math.PI / 2
    const cw = m[side === 'l' ? 'calf_l' : 'calf_r'] / Math.PI / 2
    const legX = sign * (hi * 0.5)
    paths.push(
      smoothClosed(
        limb(legX, [
          [0.5, tw * 0.95, 0],
          [0.43, tw, sign * 0.3],
          [0.34, tw * 0.78, sign * 0.2],
          [0.285, tw * 0.62, 0],
          [0.2, cw, sign * 0.3],
          [0.12, cw * 0.62, 0],
          [0.04, 2.9, 0],
        ]),
      ),
    )
  }

  return {
    paths,
    head: { cx: CX, cy: y(0.935), rx: 7.8 * px, ry: 0.068 * heightCm * px },
    y,
    px,
    half: { shoulders: sh * px, chest: ch * px, hips: hi * px },
    cx: CX,
  }
}
