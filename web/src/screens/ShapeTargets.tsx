import { useEffect, useState, type FormEvent } from 'react'
import { FormSkeleton } from '../components/Skeleton'
import { Page } from '../components/Page'
import { useNav } from '../lib/nav'
import { loadShape, REGIONS, resetTargets, saveTargets, type ShapeData } from '../lib/shape'
import { num } from '../lib/format'

const toNum = (s: string) => (s.trim() === '' ? null : parseFloat(s.replace(',', '.')))

/** Set your own target for any measurement. A left/right pair gets the same number on both sides. Empty keeps the model's. */
export default function ShapeTargets() {
  const { back } = useNav()
  const [data, setData] = useState<ShapeData | null>(null)
  const [text, setText] = useState<Record<string, string>>({}) // by region key
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadShape()
      .then((d) => {
        setData(d)
        setText(
          Object.fromEntries(
            REGIONS.map((r) => {
              const t = d.targets.find((x) => x.metric === r.metrics[0])
              return [r.key, t ? num(t.target) : '']
            }),
          ),
        )
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e?.message ?? e)))
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!data) return
    setError(null)
    const entries: { metric: string; value: number }[] = []
    for (const r of REGIONS) {
      const v = toNum(text[r.key] ?? '')
      if (v === null) continue
      if (Number.isNaN(v) || v < 5 || v > 250) return setError(`${r.label} target looks wrong: use cm, between 5 and 250.`)
      const current = data.targets.find((t) => t.metric === r.metrics[0])
      if (current && Math.abs(current.target - v) < 0.05 && !current.custom) continue // unchanged model value: do not turn it into a custom one
      for (const m of r.metrics) entries.push({ metric: m, value: v })
    }
    setBusy(true)
    try {
      await saveTargets(entries)
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function reset() {
    if (!window.confirm('Go back to the model for every target?')) return
    setBusy(true)
    try {
      await resetTargets()
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const anyCustom = data?.targets.some((t) => t.custom) ?? false

  return (
    <Page title="Targets">
      {!data && !error && <FormSkeleton fields={10} />}
      {data && data.heightCm === null && <div className="card">Add your height first (Body tab): the model targets are built from it.</div>}
      {data && data.heightCm !== null && (
        <form className="card" onSubmit={save}>
          <p className="muted note">
            In cm. The number shown is the current target; change one to set your own. Biceps, forearms, thighs and calves use the same target on both sides.
          </p>
          <div className="two-cols">
            {REGIONS.map((r) => {
              const custom = data.targets.some((t) => r.metrics.includes(t.metric) && t.custom)
              return (
                <label key={r.key}>
                  {r.label} (cm){custom ? ' · yours' : ''}
                  <input inputMode="decimal" onFocus={(e) => e.target.select()} value={text[r.key] ?? ''} onChange={(e) => setText((t) => ({ ...t, [r.key]: e.target.value }))} />
                </label>
              )
            })}
          </div>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save targets'}
          </button>
        </form>
      )}
      {anyCustom && (
        <button className="link danger" disabled={busy} onClick={reset}>
          Reset all to the model
        </button>
      )}
      {error && !data && <div className="card error">{error}</div>}
    </Page>
  )
}
