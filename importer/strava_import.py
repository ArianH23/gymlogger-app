"""Imports the RUNS of a Strava account export into the database (walks, hikes and everything else are left out).

The export is the folder Strava gives you under "Download or Delete Your Account": activities.csv plus activities/ with one
track file per activity (GPX, or TCX, possibly gzipped). Every run is saved with the database function submit_run, the same
one the phone uses, so the numbers (distance, moving time, splits) are computed in one place.

    python strava_import.py                                   dry run: reads the newest data/strava/export_* and reports
    python strava_import.py --user-id <id> --env-file .env.cloud --apply     writes to the database

Running it again is safe: a run that is already there is updated, not duplicated.
"""
import argparse
import csv
import gzip
import io
import math
import os
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime
from pathlib import Path

from hevy_import import RestClient, load_env

RUN_TYPES = {"Run"}


def _num(text):
    text = (text or "").strip()
    return float(text) if text else None


def read_runs(csv_text):
    """activities.csv -> one dict per run. The file repeats some column names (Distance is there in km and again in metres,
    Elapsed Time twice): the LAST one is the precise one, so columns are picked by position."""
    rows = list(csv.reader(io.StringIO(csv_text.lstrip("﻿"))))
    header = rows[0]
    last = {name: i for i, name in enumerate(header)}   # later columns overwrite earlier ones
    metres = 1.0 if header.count("Distance") > 1 else 1000.0   # with a single Distance column it is in km

    def col(row, name):
        i = last.get(name)
        return row[i] if i is not None and i < len(row) else ""

    runs = []
    for row in rows[1:]:
        if col(row, "Activity Type") not in RUN_TYPES:
            continue
        distance = _num(col(row, "Distance"))
        runs.append({
            "id": col(row, "Activity ID").strip(),
            "name": col(row, "Activity Name").strip(),
            "description": col(row, "Activity Description").strip(),
            "distance_m": distance * metres if distance is not None else None,
            "elapsed_s": _num(col(row, "Elapsed Time")),
            "moving_s": _num(col(row, "Moving Time")),
            "elevation_gain_m": _num(col(row, "Elevation Gain")),
            "calories": _num(col(row, "Calories")),
            "filename": col(row, "Filename").strip(),
        })
    return runs, Counter(col(r, "Activity Type") for r in rows[1:])


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _time(text):
    return datetime.fromisoformat(text.strip().replace("Z", "+00:00"))


def parse_gpx(text):
    """GPX -> (start, points). A point is [seconds from start, lat, lon, altitude, None, heart rate]: GPX has no distance."""
    root = ET.fromstring(text.strip())
    raw = []
    for el in root.iter():
        if _local(el.tag) != "trkpt":
            continue
        when = ele = hr = None
        for child in el.iter():
            name = _local(child.tag)
            if name == "time" and child.text:
                when = _time(child.text)
            elif name == "ele" and child.text:
                ele = float(child.text)
            elif name == "hr" and child.text:
                hr = float(child.text)
        if when is not None:
            raw.append((when, float(el.get("lat")), float(el.get("lon")), ele, hr))
    if not raw:
        return None, []
    start = raw[0][0]
    return start, [[(w - start).total_seconds(), lat, lon, ele, None, hr] for w, lat, lon, ele, hr in raw]


def parse_tcx(text):
    """TCX -> (start, points, totals). A point is [seconds from start, lat, lon, altitude, distance so far, heart rate].
    totals has the distance, time and calories the device wrote in the laps."""
    root = ET.fromstring(text.strip())
    totals = {"distance_m": 0.0, "elapsed_s": 0.0, "calories": 0.0}
    raw = []
    for lap in (e for e in root.iter() if _local(e.tag) == "Lap"):
        for child in lap:
            name = _local(child.tag)
            if name == "DistanceMeters" and child.text:
                totals["distance_m"] += float(child.text)
            elif name == "TotalTimeSeconds" and child.text:
                totals["elapsed_s"] += float(child.text)
            elif name == "Calories" and child.text:
                totals["calories"] += float(child.text)
    for tp in (e for e in root.iter() if _local(e.tag) == "Trackpoint"):
        when = lat = lon = alt = dist = hr = None
        for child in tp.iter():
            name = _local(child.tag)
            if not child.text or not child.text.strip():
                continue
            if name == "Time":
                when = _time(child.text)
            elif name == "LatitudeDegrees":
                lat = float(child.text)
            elif name == "LongitudeDegrees":
                lon = float(child.text)
            elif name == "AltitudeMeters":
                alt = float(child.text)
            elif name == "DistanceMeters":
                dist = float(child.text)
            elif name == "Value":   # inside HeartRateBpm
                hr = float(child.text)
        if when is not None:
            raw.append((when, lat, lon, alt, dist, hr))
    if not raw:
        return None, [], totals
    start = raw[0][0]
    return start, [[(w - start).total_seconds(), lat, lon, alt, dist, hr] for w, lat, lon, alt, dist, hr in raw], totals


def haversine_m(lat1, lon1, lat2, lon2):
    if None in (lat1, lon1, lat2, lon2):
        return 0.0
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(min(1.0, math.sqrt(a)))


def track_distance(points):
    """Metres along the track: the file's own running distance when every point has one, else between the positions."""
    if all(p[4] is not None for p in points):
        return points[-1][4] - points[0][4]
    return sum(haversine_m(a[1], a[2], b[1], b[2]) for a, b in zip(points, points[1:]))


def read_track(export_dir, filename):
    """The text of an activity file, gzipped or not. None if the export does not have it."""
    path = Path(export_dir) / filename
    if not filename or not path.exists():
        return None
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8").read()
    return path.read_text(encoding="utf-8")


def build(export_dir, user_id):
    """Pure function: the export folder -> the runs ready for submit_run, plus a report. No database access."""
    runs, types = read_runs((Path(export_dir) / "activities.csv").read_text(encoding="utf-8-sig"))
    report = Counter({"activities": sum(types.values()), "runs_in_csv": len(runs)})
    out, lines, warnings = [], [], []
    for r in runs:
        name = r["filename"].lower()
        text = read_track(export_dir, r["filename"])
        if text is None:
            report["skipped_no_file"] += 1
            warnings.append(f"{r['id']} {r['name']}: no track file ({r['filename'] or 'none listed'}), skipped")
            continue
        totals = {}
        if ".gpx" in name:
            start, points = parse_gpx(text)
            report["gpx"] += 1
        elif ".tcx" in name:
            start, points, totals = parse_tcx(text)
            report["tcx"] += 1
        else:
            report["skipped_other_format"] += 1
            warnings.append(f"{r['id']} {r['name']}: {r['filename']} is not GPX or TCX, skipped")
            continue
        if len(points) < 2:
            report["skipped_no_points"] += 1
            warnings.append(f"{r['id']} {r['name']}: fewer than 2 points in {r['filename']}, skipped")
            continue

        measured = track_distance(points)
        reported = r["distance_m"] or totals.get("distance_m") or None
        if reported and measured < 1:
            warnings.append(f"{r['id']} {r['name']}: no GPS positions in the file; Strava's {reported:.0f} m is kept, "
                            f"with an even pace and no route")
        elif reported and abs(reported - measured) / measured > 0.2:
            warnings.append(f"{r['id']} {r['name']}: Strava says {reported:.0f} m but the track measures {measured:.0f} m "
                            f"(poor GPS); Strava's distance is kept, with an even pace")
        run = {
            "source": "strava_import", "external_id": r["id"], "user_id": user_id,
            "title": r["name"] or "Run", "notes": r["description"] or None,
            "started_at": start.isoformat(),
            "distance_m": reported, "elapsed_s": r["elapsed_s"] or totals.get("elapsed_s") or None,
            "elevation_gain_m": r["elevation_gain_m"],
            "calories": r["calories"] or totals.get("calories") or None,
            "points": points,
        }
        out.append(run)
        report["runs"] += 1
        report["points"] += len(points)
        report["with_heart_rate"] += any(p[5] is not None for p in points)
        report["reported_m"] += reported or 0
        report["measured_m"] += measured
        lines.append(f"{start.astimezone().strftime('%Y-%m-%d %H:%M')}  {(reported or measured) / 1000:5.2f} km  "
                     f"(track {measured / 1000:5.2f})  {len(points):5d} pts  {'hr' if any(p[5] is not None for p in points) else '  '}  {r['name']}")
    out.sort(key=lambda x: x["started_at"])
    return {"runs": out, "report": report, "types": types, "lines": sorted(lines), "warnings": warnings}


def upload(runs, client):
    """Every run through submit_run. Returns how many were new and how many were already there."""
    result = Counter()
    for run in runs:
        r = client.http.post(f"{client.base}/rpc/submit_run", json={"p_run": run})
        if not r.ok:
            raise RuntimeError(f"run {run['external_id']} ({run['started_at']}): {r.status_code} {r.text}")
        result["created" if r.json().get("created") else "updated"] += 1
    return result


def print_report(result):
    rep = result["report"]
    print(f"activities in the export: {rep['activities']}  ({', '.join(f'{n} {t}' for t, n in result['types'].most_common())})")
    print(f"runs: {rep['runs']} of {rep['runs_in_csv']} ready  (GPX {rep['gpx']}, TCX {rep['tcx']}; with heart rate {rep['with_heart_rate']})")
    print(f"distance: Strava says {rep['reported_m'] / 1000:.1f} km, the tracks measure {rep['measured_m'] / 1000:.1f} km   points: {rep['points']}")
    for line in result["lines"]:
        print("  " + line)
    for w in result["warnings"]:
        print("WARNING:", w)


def newest_export(data_dir):
    found = sorted(Path(data_dir).glob("export_*"), key=lambda p: p.stat().st_mtime)
    return found[-1] if found else Path(data_dir)


def main():
    here = Path(__file__).parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export-dir", default=None, help="the unzipped Strava export (default: the newest data/strava/export_*)")
    ap.add_argument("--user-id", default="00000000-0000-0000-0000-000000000000")
    ap.add_argument("--env-file", default=here / ".env", help="file with SUPABASE_URL and SUPABASE_SERVICE_KEY")
    ap.add_argument("--apply", action="store_true", help="write to Supabase (default is a dry run)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    export_dir = Path(args.export_dir) if args.export_dir else newest_export(here.parent / "data" / "strava")
    print(f"export: {export_dir}")
    result = build(export_dir, args.user_id)
    print_report(result)
    if not args.apply:
        print("\nDry run: nothing was written. Add --apply to import.")
        return
    load_env(args.env_file)
    if args.user_id.startswith("00000000"):
        sys.exit("--apply needs your real --user-id (the id of your Supabase auth user)")
    if os.environ.get("SUPABASE_SERVICE_KEY", "PASTE").startswith("PASTE"):
        sys.exit(f"Put your secret key in {args.env_file} first.")
    print(f"\nWriting to {os.environ['SUPABASE_URL']} ...")
    done = upload(result["runs"], RestClient(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]))
    print(f"\nImport finished: {done['created']} new, {done['updated']} already there (updated).")


if __name__ == "__main__":
    main()
