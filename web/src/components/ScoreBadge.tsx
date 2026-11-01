import { useState } from 'react'
import { FEELINGS, TIER_CAPTION, TIER_LABEL, type Score } from '../lib/score'

type Props = { score: Score | undefined | null; size?: 'small' | 'large' }

/** The session's tier as a face plus words, and the 1-5 feeling if there is one. Renders nothing without either.
 * The face is /faces/<tier>.png (web/public/faces); until it exists the words stand alone. */
export default function ScoreBadge({ score, size = 'small' }: Props) {
  const [noFace, setNoFace] = useState(false)
  if (!score || (!score.tier && score.feeling === null)) return null
  const { tier } = score
  const feelingText = score.feeling === null ? null : `Felt ${FEELINGS[score.feeling - 1].toLowerCase()} (${score.feeling}/5)`

  if (size === 'small') {
    return (
      <span className="score-small">
        {tier && !noFace && <img className="face" src={`/faces/${tier}.png`} alt="" onError={() => setNoFace(true)} />}
        {tier && (
          <span className={`tier tier-${tier}`}>
            {TIER_LABEL[tier]} · {score.metPct}%
          </span>
        )}
        {!tier && feelingText && <span className="muted">{feelingText}</span>}
      </span>
    )
  }

  return (
    <div className="card score-card">
      {tier && !noFace && <img className="face-large" src={`/faces/${tier}.png`} alt={`${TIER_LABEL[tier]} session`} onError={() => setNoFace(true)} />}
      <div>
        {tier ? (
          <>
            <div className={`tier tier-${tier} score-title`}>
              {TIER_LABEL[tier]} · {score.metPct}%
            </div>
            <div className="muted">
              {score.metSets} of {score.plannedSets} planned sets met · {TIER_CAPTION[tier]}
            </div>
          </>
        ) : (
          <div className="muted">No plan score: this session followed no plan.</div>
        )}
        {feelingText && <div className="muted">{feelingText}</div>}
      </div>
    </div>
  )
}
