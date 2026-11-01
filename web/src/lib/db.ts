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
  sets: PlanSet[]
  last: LastSet[]
}

export type Workout = {
  id: string // becomes sessions.id in Supabase
  routineId: string
  title: string
  startedAt: string
  endedAt: string | null
  syncedAt?: string | null // set once the session, its sets and finish_session have all reached Supabase
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

// Last plan downloaded for each routine, so a workout can start with no signal.
export type CachedPlan = { routineId: string; plan: PlanExercise[]; fetchedAt: string }

class GymDB extends Dexie {
  workouts!: Table<Workout, string>
  sets!: Table<LoggedSet, string>
  plans!: Table<CachedPlan, string>

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
  }
}

export const db = new GymDB()
