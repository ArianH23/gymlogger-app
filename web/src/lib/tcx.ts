// Reads a TCX file (what Google Health exports for a GPS run) into the JSON the database function submit_run takes.
// Only reading happens here: distance, moving time, splits and elevation are computed in the database, the same way
// for every source. Written without browser-only parsing, so it can be unit tested.

/** [seconds from start, latitude, longitude, altitude m, distance so far m, heart rate]; anything but the time may be null. */
export type RunPoint = [number, number | null, number | null, number | null, number | null, number | null]

export type RunPayload = {
  source: 'google_health' | 'tcx_file'
  external_id: string
  started_at: string // ISO time of the first point
  distance_m: number | null // the device's own total
  elapsed_s: number | null
  calories: number | null
  points: RunPoint[]
}

export type ParsedRun = {
  payload: RunPayload
  sport: string // e.g. Running
  device: string | null // e.g. Google Example Watch 1
  hasHeartRate: boolean
  hasPositions: boolean
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml)
  return m ? m[1].trim() : null
}
const num = (xml: string, name: string) => {
  const t = tag(xml, name)
  if (t === null || t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Throws an Error with a readable message when the file is not a usable TCX run. */
export function parseTcx(text: string): ParsedRun {
  if (!/<TrainingCenterDatabase[\s>]/.test(text)) throw new Error('This is not a TCX file. In Google Health: Fitness, the run, More, Export.')
  const activity = /<Activity(?:\s+Sport="([^"]*)")?[^>]*>([\s\S]*?)<\/Activity>/.exec(text)
  if (!activity) throw new Error('This TCX file has no activity in it.')
  const sport = activity[1] ?? 'Unknown'
  const body = activity[2]

  // The device's totals are in each lap, outside its track.
  let distance = 0
  let elapsed = 0
  let calories = 0
  let laps = 0
  for (const lap of body.matchAll(/<Lap[^>]*>([\s\S]*?)<\/Lap>/g)) {
    const head = lap[1].replace(/<Track>[\s\S]*?<\/Track>/g, '')
    distance += num(head, 'DistanceMeters') ?? 0
    elapsed += num(head, 'TotalTimeSeconds') ?? 0
    calories += num(head, 'Calories') ?? 0
    laps += 1
  }

  const raw: { time: number; lat: number | null; lon: number | null; alt: number | null; dist: number | null; hr: number | null }[] = []
  for (const tp of body.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g)) {
    const when = tag(tp[1], 'Time')
    const time = when ? Date.parse(when) : NaN
    if (Number.isNaN(time)) continue
    const hr = /<HeartRateBpm[^>]*>\s*<Value>([^<]*)<\/Value>/.exec(tp[1])
    raw.push({
      time,
      lat: num(tp[1], 'LatitudeDegrees'),
      lon: num(tp[1], 'LongitudeDegrees'),
      alt: num(tp[1], 'AltitudeMeters'),
      dist: num(tp[1], 'DistanceMeters'),
      hr: hr && hr[1].trim() !== '' && Number.isFinite(Number(hr[1])) ? Number(hr[1]) : null,
    })
  }
  if (raw.length < 2) throw new Error('This file has no track points, so there is no run to import.')
  raw.sort((a, b) => a.time - b.time)

  const start = raw[0].time
  const device = tag(text.slice(text.indexOf('<Creator')), 'Name')
  const id = tag(body, 'Id') ?? new Date(start).toISOString()
  return {
    payload: {
      source: device && /pixel|fitbit|google/i.test(device) ? 'google_health' : 'tcx_file',
      external_id: id,
      started_at: new Date(start).toISOString(),
      distance_m: laps > 0 && distance > 0 ? distance : null,
      elapsed_s: laps > 0 && elapsed > 0 ? elapsed : null,
      calories: laps > 0 && calories > 0 ? calories : null,
      points: raw.map((p): RunPoint => [(p.time - start) / 1000, p.lat, p.lon, p.alt, p.dist, p.hr]),
    },
    sport,
    device,
    hasHeartRate: raw.some((p) => p.hr !== null),
    hasPositions: raw.some((p) => p.lat !== null && p.lon !== null),
  }
}
