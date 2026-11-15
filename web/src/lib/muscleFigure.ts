import { buildFigure, smoothClosed, VIEW_CROP_W, VIEW_H, VIEW_X, type Dims, type Pt } from './shapeGeometry'

// Where each muscle sits on the front and back view of a reference figure (180 cm tall, the proportions model). A schematic
// map to show where the work went, not an anatomy chart. Each muscle is one or more outlines, clipped to the silhouette:
// x in cm from the centre line, y as a fraction of body height (0 = floor).

export const REFERENCE_HEIGHT = 180
export const REFERENCE: Dims = {
  shoulders: 129.6, chest: 108, waist: 79.2, abdomen: 82.8, hips: 93.6, neck: 39.6,
  bicep_l: 40, bicep_r: 40, forearm_l: 31, forearm_r: 31, thigh_l: 62, thigh_r: 62, calf_l: 40, calf_r: 40,
}

type Outline = Pt[] // [x cm, y fraction]
type Layout = Record<string, Outline[]> // by muscle key

/** The same outline on the left and on the right. */
const both = (o: Outline): Outline[] => [o, o.map(([x, y]): Pt => [-x, y])]
/** A box with soft corners (the smoothing rounds it). */
const box = (x0: number, x1: number, y0: number, y1: number): Outline => [
  [x0, y0], [(x0 + x1) / 2, y0 + 0.002], [x1, y0], [x1, y1], [(x0 + x1) / 2, y1 - 0.002], [x0, y1],
]

const FOREARM: Outline = [[18.4, 0.642], [22.6, 0.65], [26.6, 0.632], [27, 0.59], [25.6, 0.535], [22.8, 0.522], [19.8, 0.56]]

export const FRONT: Layout = {
  chest: both([[0.9, 0.792], [8, 0.802], [14.6, 0.792], [16.4, 0.765], [14.6, 0.734], [8, 0.72], [1.1, 0.734]]),
  front_delts: both([[15.4, 0.814], [18.6, 0.829], [20.4, 0.82], [20.6, 0.782], [18.6, 0.764], [15.9, 0.786]]),
  side_delts: both([[21.2, 0.826], [24, 0.816], [26, 0.796], [25.8, 0.766], [23, 0.75], [21.3, 0.776]]),
  biceps: both([[16.4, 0.752], [21, 0.758], [24.6, 0.74], [25.4, 0.7], [23.4, 0.664], [19.2, 0.662], [17, 0.7]]),
  forearms: both(FOREARM),
  abs: [
    ...both(box(0.5, 5.4, 0.706, 0.673)),
    ...both(box(0.5, 5.4, 0.667, 0.634)),
    ...both(box(0.5, 5.2, 0.628, 0.595)),
    ...both([[0.5, 0.589], [5, 0.589], [4.4, 0.55], [2.2, 0.525], [0.5, 0.522]]),
  ],
  quads: both([[5.6, 0.478], [10, 0.49], [15.6, 0.47], [16.8, 0.42], [15.2, 0.335], [12, 0.292], [6.6, 0.292], [4.2, 0.34], [5.4, 0.41]]),
  adductors: both([[0.5, 0.476], [4.6, 0.47], [5, 0.42], [3.6, 0.356], [1.7, 0.38], [0.5, 0.43]]),
  calves: both([[2.6, 0.246], [7.5, 0.256], [12.8, 0.24], [13.8, 0.2], [12.4, 0.14], [9.6, 0.105], [5.6, 0.105], [2.6, 0.15], [1.4, 0.2]]),
}

export const BACK: Layout = {
  upper_back: [
    [[0, 0.868], [3.6, 0.852], [12, 0.827], [15.6, 0.812], [9.4, 0.776], [4.6, 0.722], [0, 0.7], [-4.6, 0.722], [-9.4, 0.776], [-15.6, 0.812], [-12, 0.827], [-3.6, 0.852]],
  ],
  rear_delts: both([[15.8, 0.814], [20, 0.83], [24.6, 0.814], [26, 0.786], [23.4, 0.754], [18.6, 0.762], [16, 0.786]]),
  lats: both([[5.6, 0.716], [10.2, 0.768], [16, 0.778], [16.8, 0.736], [15.4, 0.68], [12.8, 0.636], [8.6, 0.606], [3, 0.6], [1.2, 0.652]]),
  triceps: both([[16.4, 0.752], [21, 0.758], [24.8, 0.74], [25.4, 0.7], [23.6, 0.662], [19.2, 0.66], [17, 0.7]]),
  forearms: both(FOREARM),
  lower_back: both([[0.7, 0.6], [5.6, 0.595], [6.2, 0.562], [4.6, 0.534], [0.7, 0.53]]),
  glutes: both([[0.5, 0.526], [7, 0.542], [13.8, 0.526], [14.8, 0.49], [12.6, 0.455], [6.6, 0.444], [1.1, 0.46]]),
  hamstrings: both([[1.5, 0.438], [7, 0.436], [15, 0.444], [16.4, 0.4], [14.8, 0.33], [11.8, 0.292], [6.4, 0.292], [3.2, 0.34], [1.4, 0.4]]),
  calves: both([[2, 0.262], [7.5, 0.272], [13.2, 0.258], [14, 0.2], [12.6, 0.15], [9.8, 0.118], [5.4, 0.118], [2.4, 0.15], [1.2, 0.2]]),
}

export const FIGURE = buildFigure(REFERENCE, REFERENCE_HEIGHT)
export { VIEW_CROP_W, VIEW_H, VIEW_X }

const toPath = (o: Outline) => smoothClosed(o.map(([x, y]): Pt => [FIGURE.cx + x * FIGURE.px, FIGURE.y(y)]))

/** The outlines of one muscle on a view, as SVG paths. */
export const pathsFor = (layout: Layout, muscle: string) => (layout[muscle] ?? []).map(toPath)

/** Every muscle of a view with its paths, in drawing order. */
export const musclesOf = (layout: Layout) => Object.keys(layout).map((muscle) => ({ muscle, paths: pathsFor(layout, muscle) }))
