import { describe, expect, it } from 'vitest'
import { readStoredSession } from './storedSession'

const store = (entries: Record<string, string>) => {
  const keys = Object.keys(entries)
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => entries[k] ?? null }
}
const login = { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u' } }

describe('readStoredSession', () => {
  it('finds the saved login, even when its token has expired', () => {
    const s = readStoredSession(store({ 'sb-abc-auth-token': JSON.stringify(login) }))
    expect(s?.refresh_token).toBe('r')
    expect(s?.user.id).toBe('u')
  })

  it('finds it among other saved things', () => {
    const s = readStoredSession(store({ gl_routines: '[]', 'sb-abc-auth-token-code-verifier': '"x"', 'sb-abc-auth-token': JSON.stringify(login) }))
    expect(s?.access_token).toBe('a')
  })

  it('is null when signed out', () => {
    expect(readStoredSession(store({ gl_routines: '[]' }))).toBeNull()
    expect(readStoredSession(store({}))).toBeNull()
  })

  it('is null for anything that is not a usable login', () => {
    expect(readStoredSession(store({ 'sb-abc-auth-token': 'not json' }))).toBeNull()
    expect(readStoredSession(store({ 'sb-abc-auth-token': 'null' }))).toBeNull()
    expect(readStoredSession(store({ 'sb-abc-auth-token': JSON.stringify({ ...login, refresh_token: '' }) }))).toBeNull()
    expect(readStoredSession(store({ 'sb-abc-auth-token': JSON.stringify({ access_token: 'a', refresh_token: 'r' }) }))).toBeNull() // no user
  })

  it('does not throw when the storage does', () => {
    const broken = { length: 1, key: () => 'sb-abc-auth-token', getItem: () => { throw new Error('denied') } }
    expect(readStoredSession(broken)).toBeNull()
  })
})
