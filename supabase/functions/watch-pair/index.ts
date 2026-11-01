// watch-pair: signs a watch in with a 6-digit code made on the phone (create_watch_pairing).
//
//   POST { "code": "123456" }
//   200 { access_token, refresh_token, expires_in, token_type, user: { id, email } }   the code was valid
//   400 { error }                                                                      malformed request
//   401 { error }                                                                      wrong, used or expired code
//
// All the checking (single use, 10 minutes, 5 wrong guesses) happens in the database function
// claim_watch_pairing. This function only turns "this user is allowed" into a normal login: it asks Supabase Auth
// for a one-time sign-in link token for that user (no email is sent) and trades it for a session right away.
// It is deployed without JWT verification because the watch has no login yet; the code is the credential.

import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let code: unknown
  try {
    code = (await req.json()).code
  } catch {
    return json({ error: 'send JSON like {"code":"123456"}' }, 400)
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return json({ error: 'the code is 6 digits' }, 400)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: userId, error: claimError } = await admin.rpc('claim_watch_pairing', { p_code: code })
  if (claimError) return json({ error: 'could not check the code' }, 500)
  if (!userId) return json({ error: 'wrong or expired code' }, 401)

  const { data: found, error: userError } = await admin.auth.admin.getUserById(userId as string)
  const email = found?.user?.email
  if (userError || !email) return json({ error: 'could not find the account' }, 500)

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) return json({ error: 'could not create a sign-in' }, 500)

  // Trade the one-time token for a real session, with a separate client so the admin client stays clean.
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  const session = verified?.session
  if (verifyError || !session) return json({ error: 'could not sign the watch in' }, 500)

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: { id: session.user.id, email: session.user.email },
  })
})
