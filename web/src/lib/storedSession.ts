import type { Session } from '@supabase/supabase-js'

// The login is saved on the phone and renewed by the Supabase library (the access token lasts an hour). With no signal an
// expired token cannot be renewed: the library then tries for about 25 seconds and reports "no session", which would put the
// sign-in screen in front of a workout that is saved on the phone. These helpers read the saved login directly, so the app
// can keep going with it until the signal is back and the library renews it by itself.

type Store = Pick<Storage, 'length' | 'key' | 'getItem'>

/** The login saved on this device, even if its token has expired. Null when signed out (signing out removes it). */
export function readStoredSession(store: Store = localStorage): Session | null {
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue // not the "-code-verifier" or other entries
      const value = JSON.parse(store.getItem(key) ?? 'null') as Partial<Session> | null
      if (value && typeof value.refresh_token === 'string' && value.refresh_token !== '' && value.user && typeof value.access_token === 'string') {
        return value as Session
      }
    }
  } catch {
    // unreadable storage: treat as signed out
  }
  return null
}
