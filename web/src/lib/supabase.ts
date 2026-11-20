import { createClient } from '@supabase/supabase-js'
import { answerInTime, hasExpired, readStoredSession } from './storedSession'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in web/.env.local')
}

// The publishable key is meant to be public: what each user can read or write is decided by the
// database's row level security, and only a signed-in user gets any rows.
// Sessions are stored on the device and renewed automatically, so you sign in once per device.
//
// retry: false. The library retries a failed read 3 times, waiting 1, 2 and 4 seconds, which made every screen wait about
// 7 seconds with no signal before showing the copy saved on the phone. The app has its own retries (when the signal comes
// back and when it is shown again), so a failed read should fail at once.
export const supabase = createClient(url, key, { db: { retry: false } })

// An expired login cannot be renewed while the server cannot be reached, and every request would wait about 25 seconds for the
// library to give up before it fails and the screen can show its saved copy. So:
//  - with no signal (the phone knows it), answer with the saved login at once: the request fails immediately;
//  - with an expired login and the phone thinking it is online (weak Wi-Fi, a captive portal), give the renewal a few seconds,
//    then answer with the saved login anyway. The renewal carries on in the background and the login is fresh again when it works.
const getSession = supabase.auth.getSession.bind(supabase.auth)
const RENEW_WAIT_MS = 3000
const GIVE_UP_MS = 30_000
let giveUpUntil = 0 // after one renewal timed out, the next requests do not each wait for it again (a screen makes several)
if (typeof window !== 'undefined') window.addEventListener('online', () => (giveUpUntil = 0))
supabase.auth.getSession = async () => {
  const saved = readStoredSession()
  if (!saved) return getSession()
  const fallback = { data: { session: saved }, error: null } as Awaited<ReturnType<typeof getSession>>
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fallback
  if (hasExpired(saved)) {
    if (Date.now() < giveUpUntil) return fallback
    const answer = await answerInTime(getSession(), fallback, RENEW_WAIT_MS)
    if (answer === fallback) giveUpUntil = Date.now() + GIVE_UP_MS
    return answer
  }
  return getSession()
}
