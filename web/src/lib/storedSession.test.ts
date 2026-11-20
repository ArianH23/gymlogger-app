import { describe, expect, it } from 'vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { answerInTime, hasExpired, readStoredSession } from './storedSession'

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

describe('hasExpired', () => {
  const s = (secondsFromNow: number) => ({ ...login, expires_at: Math.floor(Date.now() / 1000) + secondsFromNow }) as never
  it('is true once the token has run out, or is about to', () => {
    expect(hasExpired(s(-60))).toBe(true)
    expect(hasExpired(s(5))).toBe(true)
  })
  it('is false for a token with time left', () => {
    expect(hasExpired(s(3000))).toBe(false)
  })
})

describe('answerInTime', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('gives the real answer when it comes in time', async () => {
    const p = answerInTime(Promise.resolve('real'), 'saved', 3000)
    await expect(p).resolves.toBe('real')
  })

  it('gives the saved answer when the real one is too slow, without waiting for it', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('real'), 25000))
    const p = answerInTime(slow, 'saved', 3000)
    await vi.advanceTimersByTimeAsync(3000)
    await expect(p).resolves.toBe('saved')
  })

  it('passes on an error from the real one that comes in time', async () => {
    await expect(answerInTime(Promise.reject(new Error('no')), 'saved', 3000)).rejects.toThrow('no')
  })
})
