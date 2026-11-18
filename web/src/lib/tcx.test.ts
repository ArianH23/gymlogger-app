import { describe, expect, it } from 'vitest'
import { isNotARun, parseTcx } from './tcx'

// Shaped like a real Google Health export: spaces before the XML declaration, one lap, one point per second.
const point = (time: string, lat: number, lon: number, alt: number, dist: number, hr?: number) => `
      <Trackpoint>
        <Time>${time}</Time>
        <Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position>
        <AltitudeMeters>${alt}</AltitudeMeters>
        <DistanceMeters>${dist}</DistanceMeters>${hr === undefined ? '' : `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>`}
      </Trackpoint>`

const file = (points: string, creator = 'Google Example Watch 1', sport = 'Running') => `   <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="${sport}">
      <Id>2026-07-18T07:28:41.000+02:00</Id>
      <Lap StartTime="2026-07-18T07:28:41.000+02:00">
        <TotalTimeSeconds>2016.304</TotalTimeSeconds>
        <DistanceMeters>5020.8</DistanceMeters>
        <Calories>533</Calories>
        <Intensity>Active</Intensity>
        <Track>${points}
        </Track>
      </Lap>
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>${creator}</Name><UnitId>0</UnitId></Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`

const THREE =
  point('2026-07-18T07:28:42.000+02:00', 41.402, 2.1805, 21.59, 0, 99) +
  point('2026-07-18T07:28:43.000+02:00', 41.4021, 2.1806, 21.6, 3.2, 101) +
  point('2026-07-18T07:28:45.500+02:00', 41.4023, 2.1808, 21.7, 9.9)

describe('isNotARun', () => {
  it('refuses biking, however it is written', () => {
    expect(isNotARun('Biking')).toBe(true)
    expect(isNotARun(' biking ')).toBe(true)
  })
  it('lets Running, Other and a file with no sport through (Google may not say Running)', () => {
    expect(isNotARun('Running')).toBe(false)
    expect(isNotARun('Other')).toBe(false)
    expect(isNotARun('Unknown')).toBe(false)
  })
})

describe('parseTcx', () => {
  it('reads the totals from the lap, not from the track', () => {
    const { payload } = parseTcx(file(THREE))
    expect(payload.distance_m).toBe(5020.8) // not 9.9, the last point's running distance
    expect(payload.elapsed_s).toBe(2016.304)
    expect(payload.calories).toBe(533)
  })

  it('gives each point as seconds from the first one, with position, altitude, distance and heart rate', () => {
    const { payload } = parseTcx(file(THREE))
    expect(payload.points).toEqual([
      [0, 41.402, 2.1805, 21.59, 0, 99],
      [1, 41.4021, 2.1806, 21.6, 3.2, 101],
      [3.5, 41.4023, 2.1808, 21.7, 9.9, null], // no heart rate on this point
    ])
  })

  it('takes the id from the file and the start from the first point, as a UTC time', () => {
    const { payload } = parseTcx(file(THREE))
    expect(payload.external_id).toBe('2026-07-18T07:28:41.000+02:00')
    expect(payload.started_at).toBe('2026-07-18T05:28:42.000Z')
  })

  it('recognises a Google watch, and calls any other device a plain TCX file', () => {
    expect(parseTcx(file(THREE)).payload.source).toBe('google_health')
    expect(parseTcx(file(THREE)).device).toBe('Google Example Watch 1')
    expect(parseTcx(file(THREE, 'Garmin Forerunner')).payload.source).toBe('tcx_file')
  })

  it('says what the file has', () => {
    const run = parseTcx(file(THREE, 'Google Example Watch 1', 'Biking'))
    expect(run.sport).toBe('Biking')
    expect(run.hasHeartRate).toBe(true)
    expect(run.hasPositions).toBe(true)
    const bare = `<Trackpoint><Time>2026-07-18T07:28:42.000+02:00</Time></Trackpoint><Trackpoint><Time>2026-07-18T07:28:52.000+02:00</Time></Trackpoint>`
    const noGps = parseTcx(file(bare))
    expect(noGps.hasHeartRate).toBe(false)
    expect(noGps.hasPositions).toBe(false)
    expect(noGps.payload.points[1]).toEqual([10, null, null, null, null, null])
  })

  it('puts the points in time order', () => {
    const shuffled = point('2026-07-18T07:28:45.000+02:00', 41.4, 2.18, 20, 9) + point('2026-07-18T07:28:42.000+02:00', 41.4, 2.18, 20, 0)
    expect(parseTcx(file(shuffled)).payload.points.map((p) => p[0])).toEqual([0, 3])
  })

  it('adds up several laps', () => {
    const twoLaps = file(THREE).replace('</Lap>', '</Lap><Lap StartTime="x"><TotalTimeSeconds>100</TotalTimeSeconds><DistanceMeters>300</DistanceMeters><Calories>20</Calories></Lap>')
    const { payload } = parseTcx(twoLaps)
    expect(payload.distance_m).toBeCloseTo(5320.8)
    expect(payload.elapsed_s).toBeCloseTo(2116.304)
    expect(payload.calories).toBe(553)
  })

  it('explains what is wrong with a file it cannot use', () => {
    expect(() => parseTcx('<gpx></gpx>')).toThrow(/not a TCX file/)
    expect(() => parseTcx(file(''))).toThrow(/no track points/)
    expect(() => parseTcx(file(point('2026-07-18T07:28:42.000+02:00', 41.4, 2.18, 20, 0)))).toThrow(/no track points/)
  })
})
