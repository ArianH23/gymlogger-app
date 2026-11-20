import { db } from './db'

// The workouts waiting to upload and the saved copies of the lists (routines, history...) belong to the account that was signed in.
// Signing out keeps them (the same account signing in again still needs them), but a DIFFERENT account must not see them, and must
// not upload the first one's workouts into its own data.

const USER_KEY = 'gl_user_id'
const KEEP = new Set([USER_KEY, 'gl_beep']) // the sound setting belongs to the phone, not to the account

/** True when the phone was last used by another account. A phone that has not noted an account yet is not cleared (it is the update). */
export function shouldClearFor(previousUserId: string | null, userId: string): boolean {
  return previousUserId !== null && previousUserId !== userId
}

/** Removes the workouts, sets, plans and saved copies on this phone. */
export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, db.plans, db.discards, async () => {
    await Promise.all([db.workouts.clear(), db.sets.clear(), db.plans.clear(), db.discards.clear()])
  })
  for (const key of Object.keys(localStorage)) if (key.startsWith('gl_') && !KEEP.has(key)) localStorage.removeItem(key)
  for (const key of Object.keys(sessionStorage)) if (key.startsWith('gl_')) sessionStorage.removeItem(key)
}

/** Call when a login is accepted: a different account than last time starts with nothing of the previous one's. */
export async function adoptUser(userId: string): Promise<void> {
  if (shouldClearFor(localStorage.getItem(USER_KEY), userId)) await clearLocalData()
  localStorage.setItem(USER_KEY, userId)
}
