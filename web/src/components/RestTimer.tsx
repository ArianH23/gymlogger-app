import { useEffect, useRef, useState } from 'react'

export type Rest = { endsAt: number } // epoch ms; based on a fixed end time so it stays right if the screen locks

/** Rest after a set: heavy sets (top of the rep range 10 or less) 2:30, medium (up to 15) 1:30, light 1:00. */
export function restSeconds(repsMax: number | null | undefined) {
  if (repsMax == null) return 90
  if (repsMax <= 10) return 150
  if (repsMax <= 15) return 90
  return 60
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function beep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = 880
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
  } catch {
    // no sound available: vibration and the bar still work
  }
}

type Props = { rest: Rest; onChange: (r: Rest | null) => void }

export default function RestTimer({ rest, onChange }: Props) {
  const [now, setNow] = useState(Date.now())
  const [sound, setSound] = useState(() => localStorage.getItem('gl_beep') === '1')
  const firedFor = useRef<number | null>(null)
  const remaining = rest.endsAt - now
  const done = remaining <= 0

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, 250)
    document.addEventListener('visibilitychange', tick) // catch up right away when the app comes back
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  useEffect(() => {
    if (!done || firedFor.current === rest.endsAt) return
    firedFor.current = rest.endsAt
    navigator.vibrate?.([300, 120, 300, 120, 300])
    if (sound) beep()
  }, [done, rest.endsAt, sound])

  const adjust = (seconds: number) => onChange({ endsAt: Math.max(Date.now(), rest.endsAt) + seconds * 1000 })

  function toggleSound() {
    const next = !sound
    setSound(next)
    localStorage.setItem('gl_beep', next ? '1' : '0')
  }

  return (
    <div className={`rest-bar${done ? ' done' : ''}`}>
      <div className="rest-time">{done ? 'Go!' : mmss(remaining)}</div>
      <button onClick={() => adjust(-15)} aria-label="15 seconds less">−15</button>
      <button onClick={() => adjust(15)} aria-label="15 seconds more">+15</button>
      <button onClick={toggleSound} aria-label="Toggle sound" aria-pressed={sound}>{sound ? '🔔' : '🔕'}</button>
      <button className="skip" onClick={() => onChange(null)}>{done ? 'Dismiss' : 'Skip'}</button>
    </div>
  )
}
