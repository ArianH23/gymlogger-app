import { useEffect, useState, type FormEvent } from 'react'
import { FormSkeleton } from '../components/Skeleton'
import ConfirmDialog from '../components/ConfirmDialog'
import { Page } from '../components/Page'
import { supabase } from '../lib/supabase'
import { useNav } from '../lib/nav'

type Form = {
  name: string
  equipment: string
  loadType: 'weighted' | 'bodyweight' | 'assisted'
  unilateral: boolean
  dumbbellPair: boolean
  repMin: string
  repMax: string
  increment: string
}

const EMPTY: Form = { name: '', equipment: 'machine', loadType: 'weighted', unilateral: false, dumbbellPair: false, repMin: '8', repMax: '12', increment: '' }
const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'other']

const toInt = (s: string) => (s.trim() === '' ? null : parseInt(s, 10))
const toNum = (s: string) => (s.trim() === '' ? null : parseFloat(s.replace(',', '.')))

/** Add a new exercise (no id) or edit an existing one's settings. Rep range and increment drive the plans. */
export default function ExerciseForm({ id }: { id?: string }) {
  const { back, popToRoot } = useNav()
  const [form, setForm] = useState<Form>(EMPTY)
  const [loaded, setLoaded] = useState(!id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!id) return
    supabase
      .from('exercises')
      .select('name, equipment, load_type, unilateral, dumbbell_pair, rep_min, rep_max, increment_kg')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) return setError(error?.message ?? 'Exercise not found')
        setForm({
          name: data.name,
          equipment: data.equipment ?? 'other',
          loadType: data.load_type,
          unilateral: data.unilateral,
          dumbbellPair: data.dumbbell_pair,
          repMin: data.rep_min?.toString() ?? '',
          repMax: data.rep_max?.toString() ?? '',
          increment: data.increment_kg?.toString() ?? '',
        })
        setLoaded(true)
      })
  }, [id])

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const repMin = toInt(form.repMin)
    const repMax = toInt(form.repMax)
    const increment = toNum(form.increment)
    if (!form.name.trim()) return setError('Give the exercise a name.')
    if (repMin !== null && repMax !== null && repMin > repMax) return setError('The lowest reps can’t be above the highest reps.')
    if (increment !== null && !(increment > 0)) return setError('The weight step must be above 0, or empty if you don’t know it.')

    const row = {
      name: form.name.trim(),
      equipment: form.equipment,
      load_type: form.loadType,
      unilateral: form.unilateral,
      dumbbell_pair: form.dumbbellPair,
      rep_min: repMin,
      rep_max: repMax,
      increment_kg: increment,
    }
    setBusy(true)
    const result = id
      ? await supabase.from('exercises').update(row).eq('id', id)
      : await supabase.from('exercises').insert({ id: crypto.randomUUID(), ...row })
    setBusy(false)
    if (result.error) {
      return setError(result.error.code === '23505' ? 'You already have an exercise with that name.' : result.error.message)
    }
    back()
  }

  /** Deleting keeps the logged sets in the history; the database refuses while a routine still uses the exercise. */
  async function remove() {
    setAsking(false)
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.rpc('delete_exercise', { p_exercise_id: id! })
    setBusy(false)
    if (e) return setError(e.message.charAt(0).toUpperCase() + e.message.slice(1) + (e.message.endsWith('.') ? '' : '.'))
    try {
      const saved = localStorage.getItem('gl_exercises') // the copy kept for offline use no longer lists it
      if (saved) localStorage.setItem('gl_exercises', JSON.stringify((JSON.parse(saved) as { id: string }[]).filter((x) => x.id !== id)))
    } catch {
      // a copy that cannot be read is replaced the next time the list loads
    }
    popToRoot() // the exercise's own page is gone too
  }

  return (
    <Page title={id ? 'Edit exercise' : 'New exercise'}>
      {!loaded && !error && <FormSkeleton fields={5} />}
      {loaded && (
        <form className="card" onSubmit={save}>
          <label>
            Name
            <input value={form.name} maxLength={100} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pec Fly (Machine)" required />
          </label>

          <label>
            Equipment
            <select value={form.equipment} onChange={(e) => set('equipment', e.target.value)}>
              {EQUIPMENT.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>

          <label>
            Load type
            <select value={form.loadType} onChange={(e) => set('loadType', e.target.value as Form['loadType'])}>
              <option value="weighted">Weighted</option>
              <option value="bodyweight">Bodyweight (reps only)</option>
              <option value="assisted">Assisted (the weight is the help)</option>
            </select>
          </label>

          <label className="check-row">
            <input type="checkbox" checked={form.unilateral} onChange={(e) => set('unilateral', e.target.checked)} />
            One side at a time (log left and right)
          </label>
          <label className="check-row">
            <input type="checkbox" checked={form.dumbbellPair} onChange={(e) => set('dumbbellPair', e.target.checked)} />
            Two dumbbells (the weight is the total of both)
          </label>

          <div className="two-cols">
            <label>
              Reps from
              <input inputMode="numeric" onFocus={(e) => e.target.select()} value={form.repMin} onChange={(e) => set('repMin', e.target.value)} />
            </label>
            <label>
              Reps to
              <input inputMode="numeric" onFocus={(e) => e.target.select()} value={form.repMax} onChange={(e) => set('repMax', e.target.value)} />
            </label>
          </div>
          <p className="hint">Your target range. Hit the top on every set and the next plan adds weight.</p>

          <label>
            Weight step (kg)
            <input inputMode="decimal" onFocus={(e) => e.target.select()} value={form.increment} onChange={(e) => set('increment', e.target.value)} placeholder="unknown" />
          </label>
          <p className="hint">
            The smallest jump on this machine or dumbbell rack. Leave empty if you don’t know: plans then keep the weight and say it’s time to
            go up.
          </p>

          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
      {loaded && id && (
        <button className="link danger" disabled={busy} onClick={() => setAsking(true)}>
          Delete exercise
        </button>
      )}
      {asking && (
        <ConfirmDialog title="Delete this exercise?" confirmLabel="Delete" onConfirm={remove} onCancel={() => setAsking(false)}>
          <p>It leaves your exercise list. The sets you logged stay in your history, and the name can be used again. A routine that still uses it has to drop it first.</p>
        </ConfirmDialog>
      )}
      {error && !loaded && <div className="card error">{error}</div>}
    </Page>
  )
}
