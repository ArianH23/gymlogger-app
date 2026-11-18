import { supabase } from './supabase'

/** Working sets per finished session (no warm-ups, a left/right pair counted once), keyed by session id: the same count as the session's own page. */
export async function loadSetCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const { data, error } = await supabase.from('session_set_counts').select('session_id, working_sets').in('session_id', ids)
  if (error) throw error
  for (const r of data ?? []) out.set(r.session_id as string, r.working_sets as number)
  return out
}
