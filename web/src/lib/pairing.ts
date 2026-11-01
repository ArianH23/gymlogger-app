import { supabase } from './supabase'

export type Pairing = { code: string; expiresAt: number } // expiresAt in ms since 1970

/** Asks the database for a 6-digit code that signs a watch in (valid 10 minutes, works once, replaces any earlier one). */
export async function createWatchPairing(): Promise<Pairing> {
  const { data, error } = await supabase.rpc('create_watch_pairing')
  if (error) throw error
  const r = data as { code: string; expires_at: string }
  return { code: r.code, expiresAt: new Date(r.expires_at).getTime() }
}
