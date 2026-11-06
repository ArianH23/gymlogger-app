import { muscleLabel, type ExerciseMuscle } from '../lib/muscles'

/** The muscles an exercise works: primary ones solid, secondary ones outlined. */
export default function MuscleTags({ muscles }: { muscles: ExerciseMuscle[] | undefined }) {
  if (!muscles || muscles.length === 0) return null
  return (
    <div className="muscle-tags" aria-label="Muscles worked">
      {muscles.map((m) => (
        <span key={m.muscle} className={`mtag ${m.role}`} title={m.role === 'primary' ? 'primary: a full set each' : 'secondary: half a set each'}>
          {muscleLabel(m.muscle)}
        </span>
      ))}
    </div>
  )
}
