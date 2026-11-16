import type { View } from '../lib/nav'
import ExercisePage from './ExercisePage'
import SessionPage from './SessionPage'
import ExerciseForm from './ExerciseForm'
import RoutineForm from './RoutineForm'
import RoutinePage from './RoutinePage'
import CheckinForm from './CheckinForm'
import SessionEdit from './SessionEdit'
import ShapePage from './ShapePage'
import ShapeTargets from './ShapeTargets'
import RunPage from './RunPage'
import PhotosPage from './PhotosPage'

export function PageFor({ view }: { view: View }) {
  if (view.type === 'run') return <RunPage id={view.id} />
  if (view.type === 'photos') return <PhotosPage />
  if (view.type === 'shape') return <ShapePage />
  if (view.type === 'shapeTargets') return <ShapeTargets />
  if (view.type === 'exercise') return <ExercisePage id={view.id} />
  if (view.type === 'sessionEdit') return <SessionEdit id={view.id} />
  if (view.type === 'checkinForm') return <CheckinForm id={view.id} />
  if (view.type === 'routine') return <RoutinePage id={view.id} />
  if (view.type === 'routineForm') return <RoutineForm id={view.id} />
  if (view.type === 'exerciseForm') return <ExerciseForm id={view.id} />
  return <SessionPage id={view.id} />
}
