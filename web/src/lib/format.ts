/** Number without trailing zeros: 44, 7.5, 24.5 */
export const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(Number(Number(n).toFixed(2))))

/** "24 kg (2×12)" for dumbbell pairs, "40 kg" otherwise, "50 kg assist" for assisted exercises. */
export function kgText(weight: number | null, ex: { dumbbellPair: boolean; loadType: string }) {
  if (weight === null) return 'bodyweight'
  if (ex.loadType === 'assisted') return `${num(weight)} kg assist`
  return ex.dumbbellPair ? `${num(weight)} kg (2×${num(weight / 2)})` : `${num(weight)} kg`
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export const formatDayMonth = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
