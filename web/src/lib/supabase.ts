import { createClient } from '@supabase/supabase-js'
import { readStoredSession } from './storedSession'

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

// With no signal an expired login cannot be renewed, and every request would wait about 25 seconds for the library to give up
// before it fails and the screen can show its saved copy. With no signal, answer with the saved login at once instead: the
// request then fails immediately, and the library renews the login by itself when the signal is back.
const getSession = supabase.auth.getSession.bind(supabase.auth)
supabase.auth.getSession = async () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const session = readStoredSession()
    if (session) return { data: { session }, error: null }
  }
  return getSession()
}
