import { useEffect, useState, type FormEvent } from 'react'
import { FormSkeleton } from '../components/Skeleton'
import { Page } from '../components/Page'
import { useNav } from '../lib/nav'
import { deleteCheckin, FIELDS, GROUPS, loadBody, loadCheckin, saveCheckin, todayLocal } from '../lib/checkins'
import { num } from '../lib/format'

const toNum = (s: string) => (s.trim() === '' ? null : parseFloat(s.replace(',', '.')))

const TITLES: Record<(typeof GROUPS)[number], string> = {
  Body: 'Weight and body fat',
  Circumference: 'Tape measurements',
  Recovery: 'Recovery',
  Nutrition: 'Nutrition (daily averages)',
}
const HINTS: Record<(typeof GROUPS)[number], string> = {
  Body: 'Bodyweight: your average for the week, or a morning weigh-in.',
  Circumference: 'Once a month is plenty. In the morning, relaxed, tape snug but not tight, the same spots each time. Waist is the narrowest point, abdomen is at the navel.',
  Recovery: 'Sleep: the average over the last week. Resting heart rate: the morning average from your watch is fine.',
  Nutrition: 'Average per day over the period (a week, say). A photo estimate is fine: it is a range, not an exact number.',
}

/** Log a check-in (today by default) or edit one. Every number is optional: leave empty what you did not measure. */
export default function CheckinForm({ id }: { id?: string }) {
  const { back } = useNav()
  const [day, setDay] = useState(todayLocal())
  const [notes, setNotes] = useState('')
  const [text, setText] = useState<Record<string, string>>({})
  const [last, setLast] = useState<Record<string, number>>({}) // the latest value of each metric, shown as a hint
  const [loaded, setLoaded] = useState(!id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (id) {
      loadCheckin(id)
        .then((c) => {
          setDay(c.checkedOn)
          setNotes(c.notes ?? '')
          setText(Object.fromEntries(FIELDS.map((f) => [f.col, c.values[f.col] === null ? '' : num(c.values[f.col])])))
          setLoaded(true)
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    }
    // the last value of every metric as a hint (placeholder), so a new entry is easy to compare; never filled in for you
    loadBody()
      .then((r) => setLast(Object.fromEntries(r.latest.map((l) => [l.metric, l.latestValue]))))
      .catch(() => undefined)
  }, [id])

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const values: Record<string, number | null> = {}
    for (const f of FIELDS) {
      const v = toNum(text[f.col] ?? '')
      if (v !== null && (Number.isNaN(v) || v < f.min || v > f.max)) {
        return setError(`${f.label} looks wrong: use ${f.unit}, between ${f.min} and ${f.max}.`)
      }
      values[f.col] = v
    }
    if (Object.values(values).every((v) => v === null) && !notes.trim()) return setError('Enter at least one number or a note.')
    setBusy(true)
    try {
      await saveCheckin(id, { checkedOn: day, notes: notes.trim() || null, values })
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function remove() {
    if (!id || !window.confirm('Delete this check-in?')) return
    setBusy(true)
    try {
      await deleteCheckin(id)
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const filledIn = (g: (typeof GROUPS)[number]) => FIELDS.some((f) => f.group === g && (text[f.col] ?? '').trim() !== '')

  return (
    <Page title={id ? 'Edit check-in' : 'New check-in'}>
      {!loaded && !error && <FormSkeleton fields={4} />}
      {loaded && (
        <form className="card" onSubmit={save}>
          <label>
            Day
            <input type="date" value={day} max={todayLocal()} onChange={(e) => setDay(e.target.value)} required />
          </label>

          {GROUPS.map((g) => (
            <details className="group" key={g} open={g === 'Body' || g === 'Recovery' || filledIn(g) || undefined}>
              <summary>{TITLES[g]}</summary>
              <div className="two-cols">
                {FIELDS.filter((f) => f.group === g).map((f) => (
                  <label key={f.col}>
                    {f.label} ({f.unit})
                    <input
                      inputMode="decimal"
                      onFocus={(e) => e.target.select()}
                      value={text[f.col] ?? ''}
                      onChange={(e) => setText((t) => ({ ...t, [f.col]: e.target.value }))}
                      placeholder={last[f.col] === undefined ? '' : `last: ${num(last[f.col])}`}
                    />
                  </label>
                ))}
              </div>
              <p className="hint">{HINTS[g]}</p>
            </details>
          ))}

          <label>
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="illness, travel, a bad week…" />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save check-in'}
          </button>
        </form>
      )}
      {id && loaded && (
        <button className="link danger" disabled={busy} onClick={remove}>
          Delete check-in
        </button>
      )}
      {error && !loaded && <div className="card error">{error}</div>}
    </Page>
  )
}
