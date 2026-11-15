import { useEffect, useState } from 'react'
import { loadStreak, type Streak } from '../lib/calendar'

/** Three numbers at a glance: weeks in a row with a workout, rest days since the last one, sessions this week. */
export default function StreakStats() {
  const [streak, setStreak] = useState<Streak | null | undefined>(undefined) // undefined = loading or unknown

  useEffect(() => {
    let alive = true
    const load = () =>
      loadStreak()
        .then((r) => alive && setStreak(r.streak))
        .catch(() => undefined) // a bonus: the screen works without it
    void load()
    document.addEventListener('visibilitychange', load)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', load)
    }
  }, [])

  if (!streak) return null
  return (
    <div className="stat-row streak" aria-label="Your training streak">
      <div className="stat">
        <div className="stat-value">
          {streak.weekStreak} <small>{streak.weekStreak === 1 ? 'week' : 'weeks'}</small>
        </div>
        <div className="muted">streak</div>
        {streak.bestWeekStreak > streak.weekStreak && <div className="stat-foot">best {streak.bestWeekStreak}</div>}
      </div>
      <div className="stat">
        <div className="stat-value">
          {streak.restDays} <small>{streak.restDays === 1 ? 'day' : 'days'}</small>
        </div>
        <div className="muted">rest</div>
        {streak.restDays === 0 && <div className="stat-foot">trained today</div>}
      </div>
      <div className="stat">
        <div className="stat-value">{streak.sessionsThisWeek}</div>
        <div className="muted">this week</div>
      </div>
    </div>
  )
}
