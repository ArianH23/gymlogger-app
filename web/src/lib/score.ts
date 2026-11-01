import { supabase } from './supabase'

// The score itself is computed in the database (view session_scores, function session_tier), so the phone,
// the watch and Claude always agree. This file only reads it and names things for the screen.

export type Tier = 'great' | 'good' | 'average' | 'weak' | 'poor'

export type Score = {
  sessionId: string
  plannedSets: number | null
  metSets: number | null
  metPct: number | null // null = the session followed no plan (imported or free-form)
  tier: Tier | null
  feeling: number | null // the 1-5 tap at the end of the session, if given
}

/** Labels for the five feeling buttons: 1 = awful ... 5 = great. */
export const FEELINGS = ['Awful', 'Rough', 'Normal', 'Good', 'Great']

export const TIER_LABEL: Record<Tier, string> = { great: 'Great', good: 'Good', average: 'Average', weak: 'Weak', poor: 'Poor' }

/** One line under the face. Placeholder wording, easy to change here. */
export const TIER_CAPTION: Record<Tier, string> = {
  great: 'Acceptable.',
  good: 'Solid.',
  average: 'Average.',
  weak: 'Weak.',
  poor: 'Again.',
}

type Row = {
  session_id: string
  planned_sets: number | null
  met_sets: number | null
  met_pct: number | null
  tier: Tier | null
  feeling: number | null
}

const toScore = (r: Row): Score => ({
  sessionId: r.session_id,
  plannedSets: r.planned_sets,
  metSets: r.met_sets,
  metPct: r.met_pct,
  tier: r.tier,
  feeling: r.feeling,
})

/** Scores for some sessions, keyed by session id. Sessions without a row simply have no entry. */
export async function loadScores(ids: string[]): Promise<Map<string, Score>> {
  const out = new Map<string, Score>()
  if (ids.length === 0) return out
  const { data, error } = await supabase
    .from('session_scores')
    .select('session_id, planned_sets, met_sets, met_pct, tier, feeling')
    .in('session_id', ids)
  if (error) throw error
  for (const r of (data ?? []) as Row[]) out.set(r.session_id, toScore(r))
  return out
}
