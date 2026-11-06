import { supabase } from './supabase'
import type { Dims } from './shapeGeometry'

// The shape view: each measurement against its target. The targets and the closeness are computed in the database
// (views body_shape and body_target_values, from your height or targets you set); this file reads them and groups them
// into body regions for display.

export type ShapeRow = {
  metric: string // e.g. waist_cm
  label: string
  current: number
  latestOn: string
  target: number
  custom: boolean // a target you set yourself
  gap: number // target minus current, cm (negative = to shrink)
  closeness: number // 0 to 1
  kind: 'grow' | 'shrink'
}

export type TargetRow = { metric: string; target: number; custom: boolean; kind: 'grow' | 'shrink' }

export type ShapeData = { heightCm: number | null; rows: ShapeRow[]; targets: TargetRow[] }

/** A part of the body, for the table, the tap zones and the target editor. y is the band of body height it covers (0 = floor, 1 = top of head). */
export type Region = { key: string; label: string; metrics: string[]; y: [number, number] }

export const REGIONS: Region[] = [
  { key: 'neck', label: 'Neck', metrics: ['neck_cm'], y: [0.845, 0.89] },
  { key: 'shoulders', label: 'Shoulders', metrics: ['shoulders_cm'], y: [0.775, 0.845] },
  { key: 'chest', label: 'Chest', metrics: ['chest_cm'], y: [0.69, 0.775] },
  { key: 'waist', label: 'Waist', metrics: ['waist_cm'], y: [0.615, 0.69] },
  { key: 'abdomen', label: 'Abdomen', metrics: ['abdomen_cm'], y: [0.565, 0.615] },
  { key: 'hips', label: 'Hips', metrics: ['hips_cm'], y: [0.485, 0.565] },
  { key: 'biceps', label: 'Biceps', metrics: ['bicep_l_cm', 'bicep_r_cm'], y: [0.68, 0.78] },
  { key: 'forearms', label: 'Forearms', metrics: ['forearm_l_cm', 'forearm_r_cm'], y: [0.5, 0.62] },
  { key: 'thighs', label: 'Thighs', metrics: ['thigh_l_cm', 'thigh_r_cm'], y: [0.31, 0.485] },
  { key: 'calves', label: 'Calves', metrics: ['calf_l_cm', 'calf_r_cm'], y: [0.09, 0.27] },
]

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

export type RegionStat = {
  region: Region
  measured: ShapeRow[] // the sides or points of this region that have a measurement
  current: number | null
  target: number | null
  gap: number | null
  closeness: number | null
  kind: 'grow' | 'shrink'
}

/** One line per region: measurements averaged over left and right, with the target and how close you are. */
export function regionStats(data: ShapeData): RegionStat[] {
  return REGIONS.map((region) => {
    const measured = region.metrics.map((m) => data.rows.find((r) => r.metric === m)).filter((r): r is ShapeRow => !!r)
    const targets = region.metrics.map((m) => data.targets.find((t) => t.metric === m)).filter((t): t is TargetRow => !!t)
    const kind = targets[0]?.kind ?? measured[0]?.kind ?? 'grow'
    if (measured.length === 0) {
      return { region, measured, current: null, target: targets.length ? mean(targets.map((t) => t.target)) : null, gap: null, closeness: null, kind }
    }
    const current = mean(measured.map((r) => r.current))
    const target = mean(measured.map((r) => r.target))
    return { region, measured, current, target, gap: Math.round((target - current) * 10) / 10, closeness: mean(measured.map((r) => r.closeness)), kind }
  })
}

const DIM_KEYS: (keyof Dims)[] = ['shoulders', 'chest', 'waist', 'abdomen', 'hips', 'neck', 'bicep_l', 'bicep_r', 'forearm_l', 'forearm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r']

/** The numbers the figure is drawn from. For "you", a measurement you have not taken yet falls back to the target (so no false gap is drawn). */
export function dimsFor(data: ShapeData, which: 'you' | 'target'): Dims {
  const out = {} as Dims
  for (const k of DIM_KEYS) {
    const metric = `${k}_cm`
    const target = data.targets.find((t) => t.metric === metric)?.target ?? 0
    const row = data.rows.find((r) => r.metric === metric)
    out[k] = which === 'target' ? target : (row?.current ?? target)
  }
  return out
}

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function loadShape(): Promise<ShapeData & { offline: boolean }> {
  try {
    const [shape, targets, profile] = await Promise.all([
      supabase.from('body_shape').select('metric, label, current_value, latest_on, kind, target_value, target_is_custom, gap, closeness'),
      supabase.from('body_target_values').select('metric, kind, target_value, is_custom'),
      supabase.from('body_profile').select('height_cm').maybeSingle(),
    ])
    if (shape.error) throw shape.error
    if (targets.error) throw targets.error
    const data: ShapeData = {
      heightCm: numOrNull(profile.data?.height_cm),
      rows: (shape.data ?? []).map((r) => ({
        metric: r.metric as string,
        label: r.label as string,
        current: Number(r.current_value),
        latestOn: r.latest_on as string,
        target: Number(r.target_value),
        custom: !!r.target_is_custom,
        gap: Number(r.gap),
        closeness: Number(r.closeness),
        kind: r.kind as 'grow' | 'shrink',
      })),
      targets: (targets.data ?? []).map((t) => ({ metric: t.metric as string, target: Number(t.target_value), custom: !!t.is_custom, kind: t.kind as 'grow' | 'shrink' })),
    }
    try {
      localStorage.setItem('gl_shape', JSON.stringify(data))
    } catch {
      // storage full: it still works online
    }
    return { ...data, offline: false }
  } catch (e) {
    const saved = localStorage.getItem('gl_shape')
    if (saved) return { ...(JSON.parse(saved) as ShapeData), offline: true }
    throw e
  }
}

async function userId() {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Sign in first.')
  return id
}

/** Saves targets you set by hand (one entry per measurement, in cm). */
export async function saveTargets(entries: { metric: string; value: number }[]) {
  if (entries.length === 0) return
  const user_id = await userId()
  const { error } = await supabase
    .from('body_targets')
    .upsert(entries.map((e) => ({ user_id, metric: e.metric, target_value: e.value })), { onConflict: 'user_id,metric' })
  if (error) throw new Error(error.message)
}

/** Goes back to the proportions model for every measurement. */
export async function resetTargets() {
  const { error } = await supabase.from('body_targets').delete().not('metric', 'is', null)
  if (error) throw new Error(error.message)
}
