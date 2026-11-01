import { useEffect, useState } from 'react'
import { useBackToClose } from '../lib/overlay'
import type { Pairing } from '../lib/pairing'

type Props = {
  pairing: Pairing
  busy: boolean
  error: string | null
  onNewCode: () => void
  onClose: () => void
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Shows the pairing code made on this phone, with a countdown. The code is typed on the watch with its wheels. */
export default function PairWatchSheet({ pairing, busy, error, onNewCode, onClose }: Props) {
  useBackToClose(true, onClose)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = pairing.expiresAt - now
  const expired = left <= 0

  return (
    <div className="overlay sheet" role="dialog" aria-label="Pair watch">
      <div className="overlay-inner">
        <h1>Pair watch</h1>
        <div className="card">
          <p className="muted">On the watch, open GymLogger and choose these 6 digits with the wheels. It works once.</p>
          {expired ? (
            <p className="pair-code expired">Expired</p>
          ) : (
            <p className="pair-code" aria-label={`Code ${pairing.code.split('').join(' ')}`}>
              {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
            </p>
          )}
          <p className="muted pair-left">{expired ? 'Make a new code to try again.' : `Expires in ${clock(left)}`}</p>
          {error && <p className="error">{error}</p>}
          <button className={expired ? 'primary' : 'outline'} disabled={busy} onClick={onNewCode}>
            {busy ? 'Making a code…' : 'Make a new code'}
          </button>
        </div>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
