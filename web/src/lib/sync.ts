import { db, type LoggedSet, type Workout } from './db'
import { supabase } from './supabase'
import { fromLive, setFromServer, setKey, setToServer, toLive, type ServerWorkout } from './live'
import { describeRejection, isRejection } from './syncErrors'

// One database function, sync_workout, does all the merging between devices (see its migration). This file only:
//   1. sends this phone's view of a workout (its sets, deletions, plan layout, and ended_at + feeling when finished),
//   2. adopts what comes back, so the phone shows the merged truth (another device may have logged sets too),
//   3. finds a workout that was started elsewhere (open_workout) and resumes it here.
// Every call is safe to repeat, so a dropped connection just means trying again later; nothing is lost because
// everything is saved on the phone first.

type Result = { status: 'ok' | 'finished' | 'deleted' | 'other_open'; workout?: ServerWorkout }

async function callSync(payload: unknown): Promise<Result> {
  const { data, error } = await supabase.rpc('sync_workout', { p_workout: payload as never })
  if (error) throw error
  return data as unknown as Result
}

const liveChanged = (w: Workout) => (w.liveRev ?? 0) > (w.liveSyncedRev ?? 0) || w.liveSeenAt == null

/** Sends one workout and adopts the answer. */
async function syncOne(w: Workout): Promise<void> {
  const sets = await db.sets.where('sessionId').equals(w.id).toArray()
  const sentDeleted = [...(w.deletedSetIds ?? [])]
  const sentRev = w.liveRev ?? 0
  const sendLive = !w.endedAt && liveChanged(w)
  const result = await callSync({
    id: w.id,
    routine_id: w.routineId,
    title: w.title,
    started_at: w.startedAt,
    sets: sets.map(setToServer),
    deleted_set_ids: sentDeleted,
    ...(w.replaced && Object.keys(w.replaced).length > 0 ? { replaced: w.replaced } : {}), // sent with every upload, also with a workout finished offline
    ...(sendLive ? { live: toLive(w) } : {}),
    ...(w.endedAt ? { ended_at: w.endedAt, feeling: w.feeling ?? null } : {}),
  })

  if (result.status === 'deleted') {
    await removeLocal(w.id) // thrown away on another device (or never mind: nothing to keep)
    return
  }
  if (result.status === 'other_open') {
    // A different workout is already open on another device. If this one is still empty, switch to that one;
    // otherwise keep this one apart (it uploads when it is finished).
    if (sets.length === 0) {
      await removeLocal(w.id)
      if (result.workout) await adoptRemote(result.workout)
    } else {
      await db.workouts.update(w.id, { detached: true })
    }
    return
  }
  if (result.workout) await reconcile(w.id, result.workout, { sets: new Set(sets.map((s) => s.id)), deleted: sentDeleted, rev: sentRev, sentLive: sendLive })
}

type Sent = { sets: Set<string>; deleted: string[]; rev: number; sentLive: boolean }

/** Makes the local copy match the server's merged answer, keeping anything the user did while the call was in flight. */
async function reconcile(workoutId: string, server: ServerWorkout, sent: Sent): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, async () => {
    const w = await db.workouts.get(workoutId)
    if (!w) return
    const local = await db.sets.where('sessionId').equals(workoutId).toArray()
    const serverByKey = new Map(server.sets.map((s) => [setKey({ exerciseId: s.exercise_id, setNo: s.set_no, side: s.side }), s]))
    const pendingDeleted = new Set((w.deletedSetIds ?? []).filter((id) => !sent.deleted.includes(id)))
    const matched = new Set<string>()

    for (const l of local) {
      const key = setKey(l)
      const s = serverByKey.get(key)
      if (!s) {
        // Synced before but gone from the server, or sent just now and refused (deleted wins): remove it here too.
        if (l.synced === 1 || sent.sets.has(l.id)) await db.sets.delete(l.id)
        continue // (a set logged during the call is kept and goes out next time)
      }
      matched.add(key)
      if (new Date(s.logged_at).getTime() >= new Date(l.loggedAt).getTime() || l.synced === 1) {
        if (s.id !== l.id) await db.sets.delete(l.id)
        await db.sets.put(setFromServer(s, workoutId)) // the server's row (it keeps the first id; the newer log wins)
      }
      // else: edited here while the call was in flight: keep ours, it is sent again next time
    }
    for (const [key, s] of serverByKey) {
      if (!matched.has(key) && !pendingDeleted.has(s.id)) await db.sets.put(setFromServer(s, workoutId)) // logged on another device
    }

    const patch: Partial<Workout> = { deletedSetIds: [...pendingDeleted] }
    if (sent.sentLive) {
      patch.liveSeenAt = server.live_updated_at
      patch.liveSyncedRev = sent.rev
    } else if (server.live && server.live_updated_at !== w.liveSeenAt && (w.liveRev ?? 0) === sent.rev) {
      Object.assign(patch, fromLive(server.live), { liveSeenAt: server.live_updated_at, liveSyncedRev: w.liveRev ?? 0 }) // changed on another device
    }
    if (server.ended_at) {
      patch.endedAt = w.endedAt ?? server.ended_at // finished (here, or on another device)
      patch.feeling = w.feeling ?? server.feeling
      patch.syncedAt = new Date().toISOString()
    }
    await db.workouts.update(workoutId, patch)
  })
}

async function removeLocal(id: string) {
  await db.sets.where('sessionId').equals(id).delete()
  await db.workouts.delete(id)
}

/** A workout that was started on another device becomes the open workout here. */
async function adoptRemote(server: ServerWorkout): Promise<void> {
  if (server.ended_at || !server.live || (await db.workouts.get(server.id))) return
  await db.transaction('rw', db.workouts, db.sets, async () => {
    await db.workouts.add({
      id: server.id,
      routineId: server.routine_id,
      title: server.title,
      startedAt: server.started_at,
      endedAt: null,
      feeling: server.feeling,
      ...fromLive(server.live!),
      liveRev: 0,
      liveSyncedRev: 0,
      liveSeenAt: server.live_updated_at,
    })
    await db.sets.bulkPut(server.sets.map((s) => setFromServer(s, server.id)))
  })
}

async function runOnce(): Promise<void> {
  // 1. workouts thrown away here: tell the server
  for (const d of await db.discards.toArray()) {
    await callSync({ id: d.id, discard: true })
    await db.discards.delete(d.id)
  }
  // 2. finished workouts that have not been confirmed by the server yet. One the server refuses (bad data in it) is set aside
  // with the reason and does not hold back the others; no signal and the like still stop the run, to try again later.
  const refused: string[] = []
  for (const w of await db.workouts.filter((x) => !!x.endedAt && !x.syncedAt).toArray()) {
    try {
      await syncOne(w)
      if (w.syncError) await db.workouts.update(w.id, { syncError: null })
    } catch (e) {
      if (!isRejection(e)) throw e
      const why = describeRejection(e)
      await db.workouts.update(w.id, { syncError: why })
      refused.push(`“${w.title}”: ${why}`)
    }
  }
  // 3. the open workout: share it, or look for one started elsewhere
  const open = await db.workouts.filter((x) => !x.endedAt).first()
  if (open) {
    if (!open.detached) await syncOne(open)
  } else {
    const { data, error } = await supabase.rpc('open_workout')
    if (error) throw error
    if (data) await adoptRemote(data as unknown as ServerWorkout)
  }
  if (refused.length) throw new Error(refused.join('\n'))
}

/** Puts a finished workout the server refused back in progress, so the bad set can be corrected and the workout finished again. False if another workout is open. */
export async function reopenWorkout(id: string): Promise<boolean> {
  if (await db.workouts.filter((x) => !x.endedAt).first()) return false
  await db.workouts.update(id, { endedAt: null, syncedAt: null, syncError: null })
  return true
}

/** Throws a workout away on this phone and, as soon as there is signal, on the server and the other devices. */
export async function discardWorkout(id: string): Promise<void> {
  await removeLocal(id)
  await db.discards.put({ id }) // the server (and the other devices) throw it away too
  scheduleSync(0)
}

let running: Promise<string | null> | null = null
let again = false

/** Syncs everything now. Resolves to an error message, or null. Asking again while it runs makes it run once more. */
export function syncPending(): Promise<string | null> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await runOnce()
      } while (again)
      return null
    } catch (e) {
      console.warn('Sync failed, will retry:', e)
      return e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
    } finally {
      running = null
    }
  })()
  return running
}

let timer: ReturnType<typeof setTimeout> | undefined

/** Syncs shortly from now (several changes in a row become one call). Use after logging or changing a workout. */
export function scheduleSync(delayMs = 600) {
  clearTimeout(timer)
  timer = setTimeout(() => void syncPending(), delayMs)
}

/** Marks the plan layout (exercises, extra sets, removed sets) as changed here, and syncs soon. */
export async function touchLive(workoutId: string) {
  const w = await db.workouts.get(workoutId)
  if (w) await db.workouts.update(workoutId, { liveRev: (w.liveRev ?? 0) + 1 })
  scheduleSync()
}

/** Remembers a set deleted here, so the server (and other devices) delete it too. Always recorded: it may have just been sent. */
export async function noteDeletedSet(workoutId: string, set: LoggedSet) {
  const w = await db.workouts.get(workoutId)
  if (w) await db.workouts.update(workoutId, { deletedSetIds: [...(w.deletedSetIds ?? []), set.id] })
}
