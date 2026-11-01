import { useEffect, useState, type FormEvent } from 'react'
import { Page } from '../components/Page'
import { useNav } from '../lib/nav'
import { deleteCheckin, loadBody, loadCheckin, saveCheckin, todayLocal, type Checkin } from '../lib/checkins'
import { num } from '../lib/format'

type Form = { day: string; weight: string; waist: string; sleep: string; fat: string; notes: string }

const toNum = (s: string) => (s.trim() === '' ? null : parseFloat(s.replace(',', '.')))

/** Log a check-in (today by default) or edit one. Every number is optional. */
export default function CheckinForm({ id }: { id?: string }) {
  const { back } = useNav()
  const [form, setForm] = useState<Form>({ day: todayLocal(), weight: '', waist: '', sleep: '', fat: '', notes: '' })
  const [last, setLast] = useState<Checkin | null>(null)
  const [loaded, setLoaded] = useState(!id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (id) {
      loadCheckin(id)
        .then((c) => {
          setForm({
            day: c.checkedOn,
            weight: c.bodyweightKg === null ? '' : num(c.bodyweightKg),
            waist: c.waistCm === null ? '' : num(c.waistCm),
            sleep: c.sleepHours === null ? '' : num(c.sleepHours),
            fat: c.bodyFatPct === null ? '' : num(c.bodyFatPct),
            notes: c.notes ?? '',
          })
          setLoaded(true)
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    } else {
      // show the last numbers as hints, so a new entry is easy to compare
      loadBody()
        .then((r) => setLast(r.checkins[0] ?? null))
        .catch(() => undefined)
    }
  }, [id])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const bodyweightKg = toNum(form.weight)
    const waistCm = toNum(form.waist)
    const sleepHours = toNum(form.sleep)
    const bodyFatPct = toNum(form.fat)
    if ([bodyweightKg, waistCm, sleepHours, bodyFatPct].every((v) => v === null) && !form.notes.trim()) {
      return setError('Enter at least one number or a note.')
    }
    if (bodyweightKg !== null && (bodyweightKg < 20 || bodyweightKg > 400)) return setError('Bodyweight looks wrong: use kg, between 20 and 400.')
    if (waistCm !== null && (waistCm < 30 || waistCm > 250)) return setError('Waist looks wrong: use cm, between 30 and 250.')
    if (sleepHours !== null && (sleepHours < 0 || sleepHours > 24)) return setError('Sleep must be hours per night, between 0 and 24.')
    if (bodyFatPct !== null && (bodyFatPct < 2 || bodyFatPct > 60)) return setError('Body fat must be a percentage between 2 and 60.')
    setBusy(true)
    try {
      await saveCheckin(id, { checkedOn: form.day, bodyweightKg, waistCm, sleepHours, bodyFatPct, notes: form.notes.trim() || null })
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

  const hint = (v: number | null | undefined) => (v === null || v === undefined ? '' : `last: ${num(v)}`)

  return (
    <Page title={id ? 'Edit check-in' : 'New check-in'}>
      {!loaded && !error && <p className="muted">Loading…</p>}
      {loaded && (
        <form className="card" onSubmit={save}>
          <label>
            Day
            <input type="date" value={form.day} max={todayLocal()} onChange={(e) => set('day', e.target.value)} required />
          </label>
          <div className="two-cols">
            <label>
              Bodyweight (kg)
              <input inputMode="decimal" onFocus={(e) => e.target.select()} value={form.weight} onChange={(e) => set('weight', e.target.value)} placeholder={hint(last?.bodyweightKg)} />
            </label>
            <label>
              Waist (cm)
              <input inputMode="decimal" onFocus={(e) => e.target.select()} value={form.waist} onChange={(e) => set('waist', e.target.value)} placeholder={hint(last?.waistCm)} />
            </label>
          </div>
          <div className="two-cols">
            <label>
              Sleep (h per night)
              <input inputMode="decimal" onFocus={(e) => e.target.select()} value={form.sleep} onChange={(e) => set('sleep', e.target.value)} placeholder={hint(last?.sleepHours)} />
            </label>
            <label>
              Body fat (%)
              <input inputMode="decimal" onFocus={(e) => e.target.select()} value={form.fat} onChange={(e) => set('fat', e.target.value)} placeholder={hint(last?.bodyFatPct)} />
            </label>
          </div>
          <p className="hint">
            Bodyweight: your average for the week, or a morning weigh-in. Sleep: the average over the last week. Leave empty what you didn’t measure.
          </p>
          <label>
            Notes
            <input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="illness, travel, a bad week…" />
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
