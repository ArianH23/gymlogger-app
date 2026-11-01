import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in web/.env.local')
}

// The publishable key is meant to be public: what each user can read or write is decided by the
// database's row level security, and only a signed-in user gets any rows.
// Sessions are stored on the device and renewed automatically, so you sign in once per device.
export const supabase = createClient(url, key)
