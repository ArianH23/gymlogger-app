import { supabase } from './supabase'

/** The groups of the check-in form and of the measurements table, in display order. */
export const GROUPS = ['Body', 'Circumference', 'Recovery', 'Nutrition'] as const

export type Field = {
  col: string // the column in body_checkins, also the key in Checkin.values
  label: string
  unit: string
  group: (typeof GROUPS)[number]
  min: number // the same limits as the database checks, so a typo gets a friendly message
  max: number
}

/** Every number a check-in can hold. Same names as the database (see body_metrics). An empty value means "not measured". */
export const FIELDS: Field[] = [
  { col: 'bodyweight_kg', label: 'Bodyweight', unit: 'kg', group: 'Body', min: 20, max: 400 },
  { col: 'body_fat_pct', label: 'Body fat', unit: '%', group: 'Body', min: 2, max: 60 },
  { col: 'waist_cm', label: 'Waist (narrowest)', unit: 'cm', group: 'Circumference', min: 30, max: 250 },
  { col: 'neck_cm', label: 'Neck', unit: 'cm', group: 'Circumference', min: 20, max: 70 },
  { col: 'shoulders_cm', label: 'Shoulders', unit: 'cm', group: 'Circumference', min: 70, max: 200 },
  { col: 'chest_cm', label: 'Chest', unit: 'cm', group: 'Circumference', min: 60, max: 200 },
  { col: 'abdomen_cm', label: 'Abdomen (navel)', unit: 'cm', group: 'Circumference', min: 40, max: 200 },
  { col: 'hips_cm', label: 'Hips', unit: 'cm', group: 'Circumference', min: 60, max: 200 },
  { col: 'bicep_l_cm', label: 'Left bicep', unit: 'cm', group: 'Circumference', min: 15, max: 70 },
  { col: 'bicep_r_cm', label: 'Right bicep', unit: 'cm', group: 'Circumference', min: 15, max: 70 },
  { col: 'forearm_l_cm', label: 'Left forearm', unit: 'cm', group: 'Circumference', min: 15, max: 60 },
  { col: 'forearm_r_cm', label: 'Right forearm', unit: 'cm', group: 'Circumference', min: 15, max: 60 },
  { col: 'thigh_l_cm', label: 'Left thigh', unit: 'cm', group: 'Circumference', min: 30, max: 120 },
  { col: 'thigh_r_cm', label: 'Right thigh', unit: 'cm', group: 'Circumference', min: 30, max: 120 },
  { col: 'calf_l_cm', label: 'Left calf', unit: 'cm', group: 'Circumference', min: 20, max: 70 },
  { col: 'calf_r_cm', label: 'Right calf', unit: 'cm', group: 'Circumference', min: 20, max: 70 },
  { col: 'sleep_hours', label: 'Sleep (h per night)', unit: 'h', group: 'Recovery', min: 0, max: 24 },
  { col: 'resting_hr_bpm', label: 'Resting heart rate', unit: 'bpm', group: 'Recovery', min: 30, max: 120 },
  { col: 'calories_kcal', label: 'Calories per day', unit: 'kcal', group: 'Nutrition', min: 500, max: 10000 },
  { col: 'protein_g', label: 'Protein per day', unit: 'g', group: 'Nutrition', min: 0, max: 500 },
  { col: 'steps', label: 'Steps per day', unit: 'steps', group: 'Nutrition', min: 0, max: 100000 },
]

export type Checkin = {
  id: string
  checkedOn: string // YYYY-MM-DD
  notes: string | null
  values: Record<string, number | null> // by Field.col
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

/** One number of one check-in (the view body_metrics): stored measurements and calculated ones. */
export type MetricRow = { metric: string; label: string; unit: string; group: string; ord: number; day: string; value: number }

/** One metric's latest value against about four weeks earlier (the view body_latest). */
export type LatestRow = {
  metric: string
  label: string
  unit: string
  group: string
  ord: number
  latestValue: number
  latestOn: string
  earlierValue: number | null
  earlierOn: string | null
  change: number | null
  changePct: number | null
}

export type BodyData = { checkins: Checkin[]; weeks: WeekRow[]; metrics: MetricRow[]; latest: LatestRow[]; heightCm: number | null }

/** Today as YYYY-MM-DD in the phone's own time zone (not UTC). */
export function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "2026-11-01" as a local midnight timestamp, for charts. */
export const dayToTime = (day: string) => new Date(`${day}T12:00:00`).getTime()

const COLUMNS = ['id', 'checked_on', 'notes', ...FIELDS.map((f) => f.col)].join(', ')

type Row = Record<string, unknown> & { id: string; checked_on: string; notes: string | null }

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

const fromRow = (r: Row): Checkin => ({
  id: r.id,
  checkedOn: r.checked_on,
  notes: r.notes,
  values: Object.fromEntries(FIELDS.map((f) => [f.col, numOrNull(r[f.col])])),
})

/** The server returns at most 1000 rows per request: ask page by page until a page comes back short. */
async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) return out
  }
}

/** Everything the Body tab shows. Kept on the phone for offline viewing. */
export async function loadBody(): Promise<BodyData & { offline: boolean }> {
  try {
    const [checkinRows, metricRows, latestRows, w, profile] = await Promise.all([
      allRows<Row>((a, b) => supabase.from('body_checkins').select(COLUMNS).is('deleted_at', null).order('checked_on', { ascending: false }).range(a, b) as never),
      allRows<Record<string, unknown>>((a, b) =>
        supabase.from('body_metrics').select('metric, label, unit, grp, ord, checked_on, value').order('checked_on', { ascending: true }).order('metric').range(a, b) as never,
      ),
      supabase.from('body_latest').select('metric, label, unit, grp, ord, latest_value, latest_on, earlier_value, earlier_on, change, change_pct').order('ord'),
      supabase
        .from('weekly_overview')
        .select('week_start, sessions, bodyweight_kg, sleep_hours, planned_sets, done_sets, met_sets')
        .order('week_start', { ascending: false })
        .limit(8),
      supabase.from('body_profile').select('height_cm').maybeSingle(),
    ])
    if (latestRows.error) throw latestRows.error
    if (w.error) throw w.error
    const data: BodyData = {
      checkins: checkinRows.map(fromRow),
      weeks: (w.data ?? []).map((r) => ({
        weekStart: r.week_start as string,
        sessions: Number(r.sessions),
        bodyweightKg: numOrNull(r.bodyweight_kg),
        sleepHours: numOrNull(r.sleep_hours),
        plannedSets: numOrNull(r.planned_sets),
        doneSets: numOrNull(r.done_sets),
        metSets: numOrNull(r.met_sets),
      })),
      metrics: metricRows.map((r) => ({
        metric: r.metric as string,
        label: r.label as string,
        unit: r.unit as string,
        group: r.grp as string,
        ord: Number(r.ord),
        day: r.checked_on as string,
        value: Number(r.value),
      })),
      latest: (latestRows.data ?? []).map((r) => ({
        metric: r.metric as string,
        label: r.label as string,
        unit: r.unit as string,
        group: r.grp as string,
        ord: Number(r.ord),
        latestValue: Number(r.latest_value),
        latestOn: r.latest_on as string,
        earlierValue: numOrNull(r.earlier_value),
        earlierOn: (r.earlier_on as string | null) ?? null,
        change: numOrNull(r.change),
        changePct: numOrNull(r.change_pct),
      })),
      heightCm: numOrNull(profile.data?.height_cm),
    }
    try {
      localStorage.setItem('gl_body2', JSON.stringify(data))
    } catch {
      // storage full: it still works online
    }
    return { ...data, offline: false }
  } catch (e) {
    const saved = localStorage.getItem('gl_body2')
    if (saved) return { ...(JSON.parse(saved) as BodyData), offline: true }
    throw e
  }
}

export async function loadCheckin(id: string): Promise<Checkin> {
  const { data, error } = await supabase.from('body_checkins').select(COLUMNS).eq('id', id).single()
  if (error) throw new Error(error.message)
  return fromRow(data as unknown as Row)
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
  const row = { checked_on: input.checkedOn, notes: input.notes, ...input.values }
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

/** Saves your height (once; it only changes the ratios that need it). */
export async function saveHeight(heightCm: number) {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Sign in first.')
  const { error } = await supabase.from('body_profile').upsert({ user_id: userId, height_cm: heightCm }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}
