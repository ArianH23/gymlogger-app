import gzip
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import strava_import as s  # noqa: E402

USER = "11111111-1111-1111-1111-111111111111"

# Like the real file: some names twice (Distance in km, then in metres; Elapsed Time twice).
HEADER = "Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Filename,Elapsed Time,Moving Time,Distance,Elevation Gain,Calories\n"

GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><time>2026-10-15T18:45:27Z</time></metadata>
 <trk><name>Evening Run</name><type>running</type><trkseg>
  <trkpt lat="0.0" lon="0.000"><ele>38.7</ele><time>2026-10-15T18:45:27Z</time>
   <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>110</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  <trkpt lat="0.0" lon="0.001"><ele>39.0</ele><time>2026-10-15T18:45:57Z</time>
   <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>130</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  <trkpt lat="0.0" lon="0.002"><ele>39.4</ele><time>2026-10-15T18:46:27Z</time></trkpt>
 </trkseg></trk>
</gpx>
"""

# Starts with spaces before the XML declaration, as the Google Health files do.
TCX = """   <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities><Activity Sport="Running"><Id>2026-11-14T09:40:09.000+01:00</Id>
  <Lap StartTime="2026-11-14T09:40:09.000+01:00">
   <TotalTimeSeconds>20.5</TotalTimeSeconds><DistanceMeters>50.0</DistanceMeters><Calories>7</Calories>
   <Track>
    <Trackpoint><Time>2026-11-14T09:40:10.000+01:00</Time><Position><LatitudeDegrees>41.4</LatitudeDegrees><LongitudeDegrees>2.18</LongitudeDegrees></Position>
     <AltitudeMeters>21.5</AltitudeMeters><DistanceMeters>0.0</DistanceMeters><HeartRateBpm><Value>99</Value></HeartRateBpm></Trackpoint>
    <Trackpoint><Time>2026-11-14T09:40:20.000+01:00</Time><Position><LatitudeDegrees>41.4001</LatitudeDegrees><LongitudeDegrees>2.1801</LongitudeDegrees></Position>
     <AltitudeMeters>21.9</AltitudeMeters><DistanceMeters>26.0</DistanceMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
    <Trackpoint><Time>2026-11-14T09:40:30.000+01:00</Time><Position><LatitudeDegrees>41.4002</LatitudeDegrees><LongitudeDegrees>2.1802</LongitudeDegrees></Position>
     <AltitudeMeters>22.0</AltitudeMeters><DistanceMeters>52.0</DistanceMeters><HeartRateBpm><Value>131</Value></HeartRateBpm></Trackpoint>
   </Track>
  </Lap>
 </Activity></Activities>
</TrainingCenterDatabase>
"""


@pytest.fixture
def export(tmp_path):
    (tmp_path / "activities").mkdir()
    (tmp_path / "activities" / "1.gpx").write_text(GPX, encoding="utf-8")
    with gzip.open(tmp_path / "activities" / "2.tcx.gz", "wt", encoding="utf-8") as f:
        f.write(TCX)
    (tmp_path / "activities.csv").write_text(
        HEADER
        + '1,"Oct 15, 2026, 6:45:27 PM",Evening Run,Run,felt ok,60.0,0.22,activities/1.gpx,60.0,58.0,222.0,0.7,\n'
        + '2,"Nov 14, 2026, 8:40:09 AM",Morning Run,Run,,20.0,0.05,activities/2.tcx.gz,20.0,20.0,50.0,0.5,7.0\n'
        + '3,"Nov 1, 2026, 8:00:00 AM",A walk,Walk,,600.0,0.5,activities/3.gpx,600.0,600.0,500.0,0.0,\n'
        + '4,"Nov 2, 2026, 8:00:00 AM",Lost file,Run,,600.0,2.0,activities/4.gpx,600.0,600.0,2000.0,0.0,\n',
        encoding="utf-8")
    return tmp_path


def test_read_runs_keeps_only_runs_and_takes_the_metres_column():
    runs, types = s.read_runs(HEADER + '1,"Oct 15, 2026, 6:45:27 PM",Evening Run,Run,note,60.0,0.22,activities/1.gpx,61.0,58.0,222.0,0.7,300\n'
                              + '3,"Nov 1, 2026, 8:00:00 AM",A walk,Walk,,600.0,0.5,activities/3.gpx,600.0,600.0,500.0,0.0,\n')
    assert types == {"Run": 1, "Walk": 1}
    assert len(runs) == 1
    r = runs[0]
    assert (r["id"], r["name"], r["description"], r["filename"]) == ("1", "Evening Run", "note", "activities/1.gpx")
    assert r["distance_m"] == 222.0          # the second Distance column (metres), not 0.22 km
    assert r["elapsed_s"] == 61.0            # the second Elapsed Time column
    assert (r["moving_s"], r["elevation_gain_m"], r["calories"]) == (58.0, 0.7, 300.0)


def test_a_single_distance_column_is_in_km():
    runs, _ = s.read_runs("Activity ID,Activity Name,Activity Type,Distance,Filename\n9,Old,Run,5.01,activities/9.gpx\n")
    assert runs[0]["distance_m"] == pytest.approx(5010.0)
    assert runs[0]["calories"] is None


def test_parse_gpx_gives_seconds_from_the_start_positions_altitude_and_heart_rate():
    start, points = s.parse_gpx(GPX)
    assert start.isoformat() == "2026-10-15T18:45:27+00:00"
    assert [p[0] for p in points] == [0.0, 30.0, 60.0]
    assert points[1][1:4] == [0.0, 0.001, 39.0]
    assert [p[4] for p in points] == [None, None, None]      # GPX has no running distance
    assert [p[5] for p in points] == [110.0, 130.0, None]    # the last point has no heart rate


def test_parse_tcx_reads_points_with_distance_and_the_lap_totals():
    start, points, totals = s.parse_tcx(TCX)
    assert start.isoformat() == "2026-11-14T09:40:10+01:00"   # the first point, with its time zone
    assert [p[0] for p in points] == [0.0, 10.0, 20.0]
    assert points[2] == [20.0, 41.4002, 2.1802, 22.0, 52.0, 131.0]
    assert totals == {"distance_m": 50.0, "elapsed_s": 20.5, "calories": 7.0}


def test_track_distance_uses_the_files_distance_or_measures_between_points():
    _, gpx_points = s.parse_gpx(GPX)
    assert s.track_distance(gpx_points) == pytest.approx(222.4, abs=0.5)    # 0.002 degrees along the equator
    _, tcx_points, _ = s.parse_tcx(TCX)
    assert s.track_distance(tcx_points) == 52.0


def test_build_makes_one_payload_per_run_with_a_file(export):
    result = s.build(export, USER)
    assert [r["external_id"] for r in result["runs"]] == ["1", "2"]      # oldest first; the walk and the lost file are out
    rep = result["report"]
    assert (rep["activities"], rep["runs_in_csv"], rep["runs"], rep["gpx"], rep["tcx"]) == (4, 3, 2, 1, 1)
    assert rep["skipped_no_file"] == 1 and rep["with_heart_rate"] == 2
    assert any("Lost file" in w and "no track file" in w for w in result["warnings"])

    gpx_run, tcx_run = result["runs"]
    assert gpx_run["source"] == "strava_import" and gpx_run["user_id"] == USER
    assert (gpx_run["title"], gpx_run["notes"], gpx_run["started_at"]) == ("Evening Run", "felt ok", "2026-10-15T18:45:27+00:00")
    assert (gpx_run["distance_m"], gpx_run["elapsed_s"], gpx_run["elevation_gain_m"], gpx_run["calories"]) == (222.0, 60.0, 0.7, None)
    assert len(gpx_run["points"]) == 3
    assert (tcx_run["distance_m"], tcx_run["calories"], tcx_run["notes"]) == (50.0, 7.0, None)
    assert tcx_run["started_at"] == "2026-11-14T09:40:10+01:00"


def test_build_warns_when_strava_and_the_track_disagree(export):
    text = (export / "activities.csv").read_text(encoding="utf-8").replace("58.0,222.0", "58.0,900.0")
    (export / "activities.csv").write_text(text, encoding="utf-8")
    result = s.build(export, USER)
    assert any("Strava says 900 m but the track measures 222 m" in w for w in result["warnings"])


def test_upload_sends_every_run_to_submit_run_and_counts():
    class Reply:
        ok = True

        def __init__(self, created):
            self._created = created

        def json(self):
            return {"created": self._created}

    class Http:
        def __init__(self):
            self.calls = []

        def post(self, url, json):
            self.calls.append((url, json))
            return Reply(created=len(self.calls) == 1)

    class Client:
        base = "http://x/rest/v1"
        http = Http()

    done = s.upload([{"external_id": "1", "started_at": "a"}, {"external_id": "2", "started_at": "b"}], Client())
    assert done == {"created": 1, "updated": 1}
    assert Client.http.calls[0] == ("http://x/rest/v1/rpc/submit_run", {"p_run": {"external_id": "1", "started_at": "a"}})
