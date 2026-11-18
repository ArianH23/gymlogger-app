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

export type Pt = [number, number]

/** A smooth closed path through the points (Catmull-Rom turned into Bezier curves). */
export function smoothClosed(pts: Pt[]): string {
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

/** `armSpread`: how far (cm) the hands stand out from the body, growing from the shoulder down. 0 = arms hanging close, as the muscle figure draws them. */
export function buildFigure(m: Dims, heightCm: number, opts: { armSpread?: number } = {}): Figure {
  const spread = opts.armSpread ?? 0
  const px = (FLOOR - 24) / heightCm // the figure always fills the same height
  const y = (frac: number) => FLOOR - frac * heightCm * px

  const sh = (0.385 * m.shoulders) / 2 // half width across the deltoids
  const ch = (0.31 * m.chest) / 2
  const wa = (0.31 * m.waist) / 2
  const ab = (0.31 * m.abdomen) / 2
  const hi = (0.31 * m.hips) / 2
  const nk = m.neck / Math.PI / 2
  const thigh = (m.thigh_l + m.thigh_r) / 2 / Math.PI / 2

  // The trunk without the arms: [height fraction, half width in cm] from under the jaw, down the traps to the armpit,
  // chest, waist, hips, and in to the crotch.
  const left: [number, number][] = [
    [0.908, nk * 0.78], // starts inside the head, so the jaw runs into the neck
    [0.884, nk],
    [0.868, nk * 1.03],
    [0.853, nk + 2.4],
    [0.839, nk + (sh - nk) * 0.46],
    [0.824, sh * 0.84],
    [0.795, Math.max(ch, sh * 0.72)],
    [0.74, ch],
    [0.69, ch + (wa - ch) * 0.55],
    [0.628, wa],
    [0.596, ab],
    [0.535, hi],
    [0.5, Math.max(hi * 0.99, hi * 0.5 + thigh * 0.95)], // as wide as the top of the legs: no step at the hip
    [0.474, hi * 0.88],
    [0.452, hi * 0.5],
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
    // The arm hangs from the shoulder cap and drifts away from the body, so there is daylight between arm and waist.
    const armX = sign * (sh - bw * 0.9)
    // with a spread the whole arm turns out from the shoulder: nothing at the top of the shoulder, the full amount at the hand
    const out = (f: number) => sign * spread * Math.min(Math.max((0.828 - f) / (0.828 - 0.456), 0), 1)
    const arm: [number, number, number][] = [
      [0.828, bw * 0.7, sign * -0.4], // top of the shoulder
      [0.802, bw * 1.02, sign * 0.3], // deltoid
      [0.765, bw * 0.97, sign * 0.8],
      [0.72, bw, sign * 1.4], // biceps
      [0.676, bw * 0.8, sign * 2.0],
      [0.65, ((bw * 0.8 + fw) / 2) * 0.92, sign * 2.3], // elbow
      [0.612, fw, sign * 2.9], // forearm
      [0.558, fw * 0.78, sign * 3.5],
      [0.508, fw * 0.55, sign * 4.0], // wrist
      [0.484, fw * 0.74, sign * 4.2], // hand
      [0.456, fw * 0.74, sign * 4.4],
      [0.43, fw * 0.45, sign * 4.5],
    ]
    paths.push(
      smoothClosed(
        limb(
          armX,
          arm.map(([f, hw, off]): [number, number, number] => [f, hw, off + out(f)]),
        ),
      ),
    )
    const tw = m[side === 'l' ? 'thigh_l' : 'thigh_r'] / Math.PI / 2
    const cw = m[side === 'l' ? 'calf_l' : 'calf_r'] / Math.PI / 2
    const legX = sign * (hi * 0.5)
    paths.push(
      smoothClosed(
        limb(legX, [
          [0.55, tw * 0.55, 0], // starts inside the hips, so the joint is smooth
          [0.5, tw * 0.97, 0],
          [0.455, tw, sign * 0.2], // thigh
          [0.4, tw * 0.92, sign * 0.1],
          [0.34, tw * 0.74, sign * -0.2],
          [0.296, tw * 0.6, sign * -0.4],
          [0.274, tw * 0.58, sign * -0.4], // knee
          [0.25, cw * 0.86, sign * -0.2],
          [0.205, cw, sign * 0.2], // calf
          [0.15, cw * 0.78, 0],
          [0.09, cw * 0.5, sign * -0.2], // ankle
          [0.055, cw * 0.5, sign * -0.2],
          [0.03, 4.4, sign * 0.9], // foot
          [0.012, 5.0, sign * 1.4],
          [0.002, 4.6, sign * 1.4],
        ]),
      ),
    )
  }

  return {
    paths,
    head: { cx: CX, cy: y(0.936), rx: 7.4 * px, ry: 0.064 * heightCm * px },
    y,
    px,
    half: { shoulders: sh * px, chest: ch * px, hips: hi * px },
    cx: CX,
  }
}
