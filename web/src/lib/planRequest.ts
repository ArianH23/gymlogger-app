import { supabase } from './supabase'

// "Plan with Claude": the request, its 2-minute cooldown, and where it stands are all decided in the database
// (request_routine_plan and the view routine_plan_status); this file only calls them.

export type PlanState = 'waiting' | 'no_answer' | null

export type PlanRequestResult = { requested: boolean; reason: 'recent' | 'not_configured' | null }

export async function requestRoutinePlan(routineId: string): Promise<PlanRequestResult> {
  const { data, error } = await supabase.rpc('request_routine_plan', { p_routine_id: routineId })
  if (error) throw new Error(error.message)
  const r = data as { requested: boolean; reason: PlanRequestResult['reason'] }
  return { requested: !!r.requested, reason: r.reason ?? null }
}

/** Waiting for Claude, no answer yet, or null (nothing pending). Null as well when there is no signal. */
export async function loadPlanState(routineId: string): Promise<PlanState> {
  const { data, error } = await supabase.from('routine_plan_status').select('state').eq('routine_id', routineId).maybeSingle()
  if (error || !data) return null
  return (data.state as PlanState) ?? null
}
