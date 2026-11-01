import { supabase } from './supabase'

export type Checkin = {
  id: string
  checkedOn: string // YYYY-MM-DD
  bodyweightKg: number | null
  waistCm: number | null
  sleepHours: number | null
  bodyFatPct: number | null
  notes: string | null
}

export type WeekRow = {
  weekStart: string
  sessions: number
  bodyweightKg: number | null
  sleepHours: number | null
  plannedSets: number | null
  metSets: number | null
  doneSets: number | null
}

/** Today as YYYY-MM-DD in the phone's own time zone (not UTC). */
export function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "2026-11-01" as a local midnight timestamp, for charts. */
export const dayToTime = (day: string) => new Date(`${day}T12:00:00`).getTime()

const COLUMNS = 'id, checked_on, bodyweight_kg, waist_cm, sleep_hours, body_fat_pct, notes'

type Row = {
  id: string
  checked_on: string
  bodyweight_kg: number | null
  waist_cm: number | null
  sleep_hours: number | null
  body_fat_pct: number | null
  notes: string | null
}
const fromRow = (r: Row): Checkin => ({
  id: r.id,
  checkedOn: r.checked_on,
  bodyweightKg: r.bodyweight_kg,
  waistCm: r.waist_cm,
  sleepHours: r.sleep_hours,
  bodyFatPct: r.body_fat_pct,
  notes: r.notes,
})

/** All check-ins (newest first) and the last 8 weeks of the overview. Kept on the phone for offline viewing. */
export async function loadBody(): Promise<{ checkins: Checkin[]; weeks: WeekRow[]; offline: boolean }> {
  try {
    const [c, w] = await Promise.all([
      supabase.from('body_checkins').select(COLUMNS).is('deleted_at', null).order('checked_on', { ascending: false }),
      supabase
        .from('weekly_overview')
        .select('week_start, sessions, bodyweight_kg, sleep_hours, planned_sets, done_sets, met_sets')
        .order('week_start', { ascending: false })
        .limit(8),
    ])
    if (c.error) throw c.error
    if (w.error) throw w.error
    const checkins = ((c.data ?? []) as Row[]).map(fromRow)
    const weeks: WeekRow[] = (w.data ?? []).map((r) => ({
      weekStart: r.week_start as string,
      sessions: Number(r.sessions),
      bodyweightKg: r.bodyweight_kg as number | null,
      sleepHours: r.sleep_hours as number | null,
      plannedSets: r.planned_sets as number | null,
      doneSets: r.done_sets as number | null,
      metSets: r.met_sets as number | null,
    }))
    localStorage.setItem('gl_body', JSON.stringify({ checkins, weeks }))
    return { checkins, weeks, offline: false }
  } catch (e) {
    const saved = localStorage.getItem('gl_body')
    if (saved) return { ...(JSON.parse(saved) as { checkins: Checkin[]; weeks: WeekRow[] }), offline: true }
    throw e
  }
}

export async function loadCheckin(id: string): Promise<Checkin> {
  const { data, error } = await supabase.from('body_checkins').select(COLUMNS).eq('id', id).single()
  if (error) throw new Error(error.message)
  return fromRow(data as Row)
}

/** The most recent check-in date, or null if there is none (or no signal). Used for the "due" reminder. */
export async function latestCheckinDay(): Promise<string | null> {
  const { data, error } = await supabase
    .from('body_checkins')
    .select('checked_on')
    .is('deleted_at', null)
    .order('checked_on', { ascending: false })
    .limit(1)
  if (error) return null
  return (data?.[0]?.checked_on as string | undefined) ?? null
}

export type CheckinInput = Omit<Checkin, 'id'>

export async function saveCheckin(id: string | undefined, input: CheckinInput) {
  const row = {
    checked_on: input.checkedOn,
    bodyweight_kg: input.bodyweightKg,
    waist_cm: input.waistCm,
    sleep_hours: input.sleepHours,
    body_fat_pct: input.bodyFatPct,
    notes: input.notes,
  }
  const result = id
    ? await supabase.from('body_checkins').update(row).eq('id', id)
    : await supabase.from('body_checkins').insert({ id: crypto.randomUUID(), ...row })
  if (result.error) {
    throw new Error(result.error.code === '23505' ? 'You already have a check-in on that day. Edit it from the list.' : result.error.message)
  }
}

export async function deleteCheckin(id: string) {
  const { error } = await supabase.from('body_checkins').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}
