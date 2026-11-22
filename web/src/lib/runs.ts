import { supabase } from './supabase'
import type { RunPayload } from './tcx'

// Runs. Every number (distance, moving time, pace, splits, bests, weekly totals) is computed in the database
// (submit_run and the views run_summary, run_bests, weekly_runs); this file reads them and formats them.

export type RunRow = {
  id: string
  startedAt: string
  title: string
  source: string
  distanceKm: number
  movingS: number
  elapsedS: number
  paceSPerKm: number
  elevationGainM: number | null
  avgHr: number | null
  maxHr: number | null
  calories: number | null
  notes: string | null
}

export type RunSplit = { km: number; distanceM: number; seconds: number; elevChangeM: number | null; avgHr: number | null }

/** One point of the thinned route. */
export type TrackPoint = { t: number; lat: number | null; lon: number | null; alt: number | null; d: number; hr: number | null }

export type RunDetail = { run: RunRow; splits: RunSplit[]; track: TrackPoint[] }

export type RunWeek = { weekStart: string; runs: number; distanceKm: number; paceSPerKm: number }
export type RunBest = { kind: 'best_1k' | 'best_5k' | 'best_10k' | 'longest'; value: number; runId: string; day: string }
export type RunTrends = { weeks: RunWeek[]; bests: RunBest[] }

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** 33:26, or 1:09:56 from an hour up. */
export function formatDuration(seconds: number) {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

/** Pace as minutes:seconds per km, e.g. 6:40. */
export const formatPace = (secondsPerKm: number) => formatDuration(secondsPerKm)

export const formatKm = (km: number) => km.toFixed(2)

const COLUMNS = 'run_id, started_at, title, source, distance_km, moving_s, elapsed_s, pace_s_per_km, elevation_gain_m, avg_hr_bpm, max_hr_bpm, calories_kcal, notes'

const toRow = (r: Record<string, unknown>): RunRow => ({
  id: r.run_id as string,
  startedAt: r.started_at as string,
  title: r.title as string,
  source: r.source as string,
  distanceKm: Number(r.distance_km),
  movingS: Number(r.moving_s),
  elapsedS: Number(r.elapsed_s),
  paceSPerKm: Number(r.pace_s_per_km),
  elevationGainM: numOrNull(r.elevation_gain_m),
  avgHr: numOrNull(r.avg_hr_bpm),
  maxHr: numOrNull(r.max_hr_bpm),
  calories: numOrNull(r.calories_kcal),
  notes: (r.notes as string | null) ?? null,
})

const cached = <T,>(key: string): T | null => {
  const saved = localStorage.getItem(key)
  return saved ? (JSON.parse(saved) as T) : null
}
const remember = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full: it still works online
  }
}

/** Every run, newest first. Falls back to the last copy on this phone when there is no signal. */
export async function loadRuns(): Promise<{ runs: RunRow[]; offline: boolean }> {
  const { data, error } = await supabase.from('run_summary').select(COLUMNS).order('started_at', { ascending: false })
  if (error) {
    const saved = cached<RunRow[]>('gl_runs')
    if (saved) return { runs: saved, offline: true }
    throw new Error(error.message)
  }
  const runs = ((data ?? []) as unknown as Record<string, unknown>[]).map(toRow)
  remember('gl_runs', runs)
  return { runs, offline: false }
}

export async function loadRun(id: string): Promise<{ detail: RunDetail; offline: boolean }> {
  const key = `gl_run_${id}`
  const [summary, track, splits] = await Promise.all([
    supabase.from('run_summary').select(COLUMNS).eq('run_id', id).maybeSingle(),
    supabase.from('runs').select('track').eq('id', id).maybeSingle(),
    supabase.from('run_splits').select('km, distance_m, seconds, elev_change_m, avg_hr_bpm').eq('run_id', id).order('km'),
  ])
  const failed = summary.error ?? track.error ?? splits.error
  if (failed) {
    const saved = cached<RunDetail>(key)
    if (saved) return { detail: saved, offline: true }
    throw new Error(failed.message)
  }
  if (!summary.data || !track.data) throw new Error('This run is not there any more.')
  const detail: RunDetail = {
    run: toRow(summary.data as unknown as Record<string, unknown>),
    splits: (splits.data ?? []).map((s) => ({
      km: Number(s.km),
      distanceM: Number(s.distance_m),
      seconds: Number(s.seconds),
      elevChangeM: numOrNull(s.elev_change_m),
      avgHr: numOrNull(s.avg_hr_bpm),
    })),
    track: ((track.data.track ?? []) as (number | null)[][]).map((p) => ({ t: Number(p[0]), lat: p[1], lon: p[2], alt: p[3], d: Number(p[4]), hr: p[5] })),
  }
  remember(key, detail)
  return { detail, offline: false }
}

/** Saves an imported run. created is false when the run was already there and has been updated. */
export async function submitRun(payload: RunPayload): Promise<{ runId: string; created: boolean }> {
  const { data, error } = await supabase.rpc('submit_run', { p_run: payload })
  if (error) throw new Error(error.message)
  const r = data as { run_id: string; created: boolean }
  return { runId: r.run_id, created: !!r.created }
}

export async function updateRun(id: string, title: string, notes: string | null) {
  const { error } = await supabase.from('runs').update({ title, notes }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteRun(id: string) {
  const { error } = await supabase.from('runs').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The last 12 weeks that have runs (oldest first) and your bests. */
export async function loadRunTrends(): Promise<RunTrends> {
  const from = new Date()
  from.setDate(from.getDate() - 12 * 7)
  const [weeks, bests] = await Promise.all([
    supabase.from('weekly_runs').select('week_start, runs, distance_km, pace_s_per_km').gte('week_start', isoDay(from)).order('week_start'),
    supabase.from('run_bests').select('kind, value, run_id, day'),
  ])
  if (weeks.error) throw new Error(weeks.error.message)
  if (bests.error) throw new Error(bests.error.message)
  return {
    weeks: (weeks.data ?? []).map((w) => ({ weekStart: w.week_start as string, runs: Number(w.runs), distanceKm: Number(w.distance_km), paceSPerKm: Number(w.pace_s_per_km) })),
    bests: (bests.data ?? []).map((b) => ({ kind: b.kind as RunBest['kind'], value: Number(b.value), runId: b.run_id as string, day: b.day as string })),
  }
}
