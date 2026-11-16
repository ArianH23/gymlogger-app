import Dexie, { type Table } from 'dexie'

// Everything you log is written here first (IndexedDB on the phone), so a bad signal can never lose a set.
// Step 5 uploads unsynced rows to Supabase.

export type PlanSet = {
  setNo: number
  weightKg: number | null
  repsMin: number | null
  repsMax: number | null
  note: string | null
}

export type LastSet = {
  setNo: number
  weightKg: number | null
  repsL: number | null
  repsR: number | null
  repsResult: number | null
}

export type PlanExercise = {
  exerciseId: string
  name: string
  loadType: 'weighted' | 'bodyweight' | 'assisted'
  unilateral: boolean
  dumbbellPair: boolean
  incrementKg?: number | null // the step for changing the weight (the watch's wheel uses it)
  sets: PlanSet[]
  last: LastSet[]
  // What to do instead when the machine is taken (set on the routine). Swapping puts it in this place, with this one as its backup.
  backup?: PlanExercise | null
  swapped?: boolean // true = this is the backup, standing in for the planned exercise (which is now in `backup`)
}

export type Workout = {
  id: string // becomes sessions.id in Supabase
  routineId: string | null // null = an empty workout built on the fly
  title: string
  startedAt: string
  endedAt: string | null
  feeling?: number | null // optional 1-5 "how did it feel", tapped when finishing
  syncedAt?: string | null // set once the session, its sets and finish_session have all reached Supabase
  // Sharing the open workout with other devices (see lib/sync.ts and the database function sync_workout):
  removedSets?: Record<string, number[]> // exerciseId -> set numbers taken off the list (the watch can do this)
  deletedSetIds?: string[] // sets deleted here that the server may still have; sent with the next sync
  liveRev?: number // bumped whenever the plan layout (exercises, extra/removed sets) changes here
  liveSyncedRev?: number // the liveRev the server has seen
  liveSeenAt?: string | null // the server's live_updated_at we last adopted
  detached?: boolean // another workout was already open elsewhere when this one first synced: it uploads when finished instead
  plan: PlanExercise[] // snapshot taken at start, so the screen works offline
  extraSets: Record<string, number> // exerciseId -> number of extra sets added with "+ Set"
}

export type LoggedSet = {
  id: string // becomes sets.id in Supabase
  sessionId: string
  exerciseId: string
  setNo: number
  side: 'L' | 'R' | null
  weightKg: number | null
  reps: number
  isWarmup: boolean
  loggedAt: string
  synced: 0 | 1
}

export type Discard = { id: string }

// Last plan downloaded for each routine, so a workout can start with no signal.
export type CachedPlan = { routineId: string; plan: PlanExercise[]; fetchedAt: string }

class GymDB extends Dexie {
  workouts!: Table<Workout, string>
  sets!: Table<LoggedSet, string>
  plans!: Table<CachedPlan, string>
  discards!: Table<Discard, string> // workouts thrown away here whose deletion still has to reach the server

  constructor() {
    super('gymlogger')
    this.version(1).stores({
      workouts: 'id, routineId, endedAt',
      sets: 'id, sessionId, synced',
    })
    this.version(2).stores({
      workouts: 'id, routineId, endedAt',
      sets: 'id, sessionId, synced',
      plans: 'routineId',
    })
    this.version(3).stores({
      workouts: 'id, routineId, endedAt',
      sets: 'id, sessionId, synced',
      plans: 'routineId',
      discards: 'id',
    })
  }
}

export const db = new GymDB()
