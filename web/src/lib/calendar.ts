import { supabase } from './supabase'

// The workout calendar and the week streak. What counts as a workout day, a week and a streak is decided in the database
// (views workout_calendar and training_streak, local time, weeks from Monday); this file only reads them.

export type Streak = {
  weekStreak: number // weeks in a row with a workout (still alive during the current week)
  bestWeekStreak: number
  lastSessionDay: string // YYYY-MM-DD
  restDays: number // days since the last session, 0 = trained today
  sessionsThisWeek: number
}

/** Null when there is no finished session yet. Falls back to the last copy on this phone when there is no signal. */
export async function loadStreak(): Promise<{ streak: Streak | null; offline: boolean }> {
  try {
    const { data, error } = await supabase
      .from('training_streak')
      .select('week_streak, best_week_streak, last_session_day, rest_days, sessions_this_week')
      .maybeSingle()
    if (error) throw error
    const streak: Streak | null = data
      ? {
          weekStreak: Number(data.week_streak),
          bestWeekStreak: Number(data.best_week_streak),
          lastSessionDay: data.last_session_day as string,
          restDays: Number(data.rest_days),
          sessionsThisWeek: Number(data.sessions_this_week),
        }
      : null
    try {
      localStorage.setItem('gl_streak', JSON.stringify(streak))
    } catch {
      // storage full: it still works online
    }
    return { streak, offline: false }
  } catch (e) {
    const saved = localStorage.getItem('gl_streak')
    if (saved !== null) return { streak: JSON.parse(saved) as Streak | null, offline: true }
    throw e
  }
}

export type CalendarSession = { day: string; sessionId: string; title: string }

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** The finished sessions of one month (month is 0-based, as in Date), oldest first. */
export async function loadMonth(year: number, month: number): Promise<CalendarSession[]> {
  const next = month === 11 ? iso(year + 1, 0, 1) : iso(year, month + 1, 1)
  const { data, error } = await supabase
    .from('workout_calendar')
    .select('day, session_id, title')
    .gte('day', iso(year, month, 1))
    .lt('day', next)
    .order('started_at')
  if (error) throw error
  return (data ?? []).map((r) => ({ day: r.day as string, sessionId: r.session_id as string, title: r.title as string }))
}

export { iso as isoDay }
