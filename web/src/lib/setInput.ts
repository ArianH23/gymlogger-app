// What may be typed for a set in the live workout. The database refuses a negative number or one that does not fit
// (reps are a whole number from 0, the weight a number from 0 with two decimals and at most four digits before them),
// and one refused set would stop the whole workout from uploading. So the logger checks first, with limits no real set reaches.

export const MAX_REPS = 500
export const MAX_WEIGHT_KG = 2000

export type SetInput = { ok: true; weightKg: number | null; reps: number } | { ok: false; message: string }

/** Reads the weight and reps boxes. An empty weight means bodyweight (no weight). */
export function parseSetInput(weightText: string, repsText: string): SetInput {
  const repsRaw = repsText.trim()
  if (repsRaw === '') return { ok: false, message: 'Enter the reps.' }
  const reps = Number(repsRaw.replace(',', '.'))
  if (!Number.isInteger(reps) || reps < 0 || reps > MAX_REPS) return { ok: false, message: `Reps are a whole number from 0 to ${MAX_REPS}.` }

  const weightRaw = weightText.trim()
  if (weightRaw === '') return { ok: true, weightKg: null, reps }
  const weight = Number(weightRaw.replace(',', '.'))
  if (!Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT_KG) return { ok: false, message: `The weight is a number from 0 to ${MAX_WEIGHT_KG} kg.` }
  return { ok: true, weightKg: Math.round(weight * 100) / 100, reps }
}
