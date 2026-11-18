// Telling the two kinds of upload failure apart. No signal, a signed-out session or a slow server pass by themselves, so the
// workout just waits. But when the database refuses the DATA (a negative number, a value that does not fit), sending the same
// workout again can never work: it is set aside with the reason, and the workouts behind it still upload.

type DbError = { code?: unknown; message?: unknown; details?: unknown }

/** True when the database refused the data itself: a data error (class 22), a broken rule (class 23) or one of the function's own refusals (P0001). */
export function isRejection(e: unknown): boolean {
  const code = (e as DbError | null)?.code
  return typeof code === 'string' && /^(22|23|P0001)/.test(code)
}

const KNOWN: Record<string, string> = {
  sets_reps_check: 'a set has reps below 0',
  sets_weight_kg_check: 'a set has a weight below 0',
}

/** The reason in words a person can act on, instead of the database's own text. */
export function describeRejection(e: unknown): string {
  const err = (e ?? {}) as DbError
  const message = typeof err.message === 'string' ? err.message : String(e)
  const constraint = /constraint "([^"]+)"/.exec(message)?.[1]
  if (constraint && KNOWN[constraint]) return `${KNOWN[constraint]}, which the server cannot store.`
  if (err.code === '22003' || /numeric field overflow|out of range/i.test(message)) return 'a weight or a number of reps is too large for the server to store.'
  if (err.code === '22P02' || /invalid input syntax/i.test(message)) return 'a value in it is not a valid number.'
  return message
}
