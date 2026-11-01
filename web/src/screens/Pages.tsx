import type { View } from '../lib/nav'
import ExercisePage from './ExercisePage'
import SessionPage from './SessionPage'
import ExerciseForm from './ExerciseForm'

export function PageFor({ view }: { view: View }) {
  if (view.type === 'exercise') return <ExercisePage id={view.id} />
  if (view.type === 'exerciseForm') return <ExerciseForm id={view.id} />
  return <SessionPage id={view.id} />
}
