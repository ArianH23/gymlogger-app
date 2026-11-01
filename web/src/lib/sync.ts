import { db, type Workout } from './db'
import { supabase } from './supabase'

// Uploads finished workouts: session first, then its sets, then finish_session (which marks the plan as
// used, writes the automatic plan, and starts Claude on the next one). Every row keeps the id it was
// created with and is written with an upsert, so repeating any step after a dropped connection is safe.

async function uploadWorkout(w: Workout) {
  const sets = await db.sets.where('sessionId').equals(w.id).toArray()

  const { error: sessionError } = await supabase.from('sessions').upsert(
    {
      id: w.id,
      routine_id: w.routineId,
      title: w.title,
      started_at: w.startedAt,
      ended_at: w.endedAt,
      ...(w.feeling ? { feeling: w.feeling } : {}), // only when tapped: an upload with no feeling never depends on the column
      source: 'app',
    },
    { onConflict: 'id' },
  )
  if (sessionError) throw sessionError

  for (let i = 0; i < sets.length; i += 200) {
    const chunk = sets.slice(i, i + 200)
    const { error } = await supabase.from('sets').upsert(
      chunk.map((s) => ({
        id: s.id,
        session_id: s.sessionId,
        exercise_id: s.exerciseId,
        set_no: s.setNo,
        side: s.side,
        weight_kg: s.weightKg,
        reps: s.reps,
        is_warmup: s.isWarmup,
        logged_at: s.loggedAt,
      })),
      { onConflict: 'id' },
    )
    if (error) throw error
  }
  await db.sets.where('sessionId').equals(w.id).modify({ synced: 1 })

  const { error: finishError } = await supabase.rpc('finish_session', { p_session_id: w.id })
  if (finishError) throw finishError
  await db.workouts.update(w.id, { syncedAt: new Date().toISOString() })
}

let running: Promise<string | null> | null = null

/** Uploads every finished workout that hasn't been uploaded yet. Resolves to an error message, or null. */
export function syncPending(): Promise<string | null> {
  if (!running) {
    running = (async () => {
      try {
        const pending = await db.workouts.filter((w) => !!w.endedAt && !w.syncedAt).toArray()
        for (const w of pending) await uploadWorkout(w)
        return null
      } catch (e) {
        console.warn('Upload failed, will retry:', e)
        return e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
      } finally {
        running = null
      }
    })()
  }
  return running
}
