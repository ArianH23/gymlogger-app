import { buildFigure, VIEW_CROP_W, VIEW_H, VIEW_X, type Dims } from './shapeGeometry'

// Where each muscle sits on the front and back view of a reference figure (180 cm tall, the proportions model). A schematic
// map to show where the work went, not an anatomy chart. Each muscle is an ellipse (or a pair, left and right) clipped to the
// silhouette: x in cm from the centre line, y as a fraction of body height (0 = floor), rx in cm, ry as a fraction of height.

export const REFERENCE_HEIGHT = 180
export const REFERENCE: Dims = {
  shoulders: 129.6, chest: 108, waist: 79.2, abdomen: 82.8, hips: 93.6, neck: 39.6,
  bicep_l: 40, bicep_r: 40, forearm_l: 31, forearm_r: 31, thigh_l: 62, thigh_r: 62, calf_l: 40, calf_r: 40,
}

type Spot = { x: number; y: number; rx: number; ry: number }
type Layout = Record<string, Spot[]> // by muscle key

const pair = (x: number, y: number, rx: number, ry: number): Spot[] => [
  { x: -x, y, rx, ry },
  { x, y, rx, ry },
]

export const FRONT: Layout = {
  chest: pair(7, 0.745, 8.5, 0.03),
  front_delts: pair(19.5, 0.795, 4.5, 0.025),
  side_delts: pair(23, 0.79, 3, 0.025),
  biceps: pair(19, 0.725, 5, 0.04),
  forearms: pair(20.5, 0.585, 4.5, 0.055),
  abs: [{ x: 0, y: 0.625, rx: 7, ry: 0.06 }],
  quads: pair(7.5, 0.39, 8.5, 0.08),
  adductors: pair(3, 0.4, 3, 0.07),
  calves: pair(7.5, 0.19, 5.5, 0.065),
}

export const BACK: Layout = {
  upper_back: [{ x: 0, y: 0.77, rx: 12, ry: 0.04 }],
  rear_delts: pair(19.5, 0.795, 4.5, 0.025),
  lats: pair(9, 0.7, 8, 0.05),
  triceps: pair(19, 0.725, 5, 0.04),
  lower_back: [{ x: 0, y: 0.62, rx: 7, ry: 0.04 }],
  glutes: pair(7, 0.52, 8.5, 0.04),
  hamstrings: pair(7.5, 0.39, 8.5, 0.08),
  calves: pair(7.5, 0.19, 6, 0.065),
}

export const FIGURE = buildFigure(REFERENCE, REFERENCE_HEIGHT)
export { VIEW_CROP_W, VIEW_H, VIEW_X }

/** The pixel ellipses of one muscle on a view. */
export const ellipsesFor = (layout: Layout, muscle: string) =>
  (layout[muscle] ?? []).map((s) => ({
    cx: FIGURE.cx + s.x * FIGURE.px,
    cy: FIGURE.y(s.y),
    rx: s.rx * FIGURE.px,
    ry: s.ry * REFERENCE_HEIGHT * FIGURE.px,
  }))
