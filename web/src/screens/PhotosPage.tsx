import { useEffect, useMemo, useRef, useState } from 'react'
import { Page } from '../components/Page'
import { ChartSkeleton } from '../components/Skeleton'
import { addPhoto, deletePhoto, loadPhotos, photoUrl, POSES, type Photo, type Pose } from '../lib/photos'
import { formatDate } from '../lib/format'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayLabel = (day: string) => formatDate(`${day}T12:00:00`)
const message = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e))

/** One photo, loaded through a link that only works for a while (the files are private). */
function PhotoImage({ photo, alt }: { photo: Photo; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let current = true
    photoUrl(photo.path)
      .then((u) => current && setUrl(u))
      .catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [photo.path])
  if (failed) return <div className="photo-frame photo-missing">Could not load</div>
  if (!url) return <div className="photo-frame skel" />
  return <img className="photo-frame" src={url} alt={alt} />
}

/** Progress photos: the same pose on two dates, side by side, and the list of every photo of that pose. */
export default function PhotosPage() {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [pose, setPose] = useState<Pose>('front')
  const [then, setThen] = useState<string | null>(null) // photo ids; null = the earliest / the latest
  const [now, setNow] = useState<string | null>(null)
  const [day, setDay] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadPhotos()
      .then(setPhotos)
      .catch((e) => setError(message(e)))
  }, [])

  // this pose's photos, newest first
  const ofPose = useMemo(() => (photos ?? []).filter((p) => p.pose === pose), [photos, pose])
  const latest = ofPose[0]
  const earliest = ofPose[ofPose.length - 1]
  const nowPhoto = ofPose.find((p) => p.id === now) ?? latest
  const thenPhoto = ofPose.find((p) => p.id === then) ?? earliest
  const poseLabel = POSES.find((p) => p.key === pose)!.label

  async function picked(file: File | undefined) {
    if (!file || !photos) return
    setBusy(true)
    setError(null)
    try {
      const added = await addPhoto(file, pose, day, photos)
      setPhotos([added, ...photos.filter((p) => !(p.pose === pose && p.takenOn === day))].sort((a, b) => b.takenOn.localeCompare(a.takenOn)))
      setNow(null)
      setThen(null)
    } catch (e) {
      setError(message(e))
    }
    setBusy(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function remove(photo: Photo) {
    if (!window.confirm(`Delete the ${poseLabel.toLowerCase()} photo of ${dayLabel(photo.takenOn)}?`)) return
    setError(null)
    try {
      await deletePhoto(photo)
      setPhotos((list) => (list ?? []).filter((p) => p.id !== photo.id))
    } catch (e) {
      setError(message(e))
    }
  }

  return (
    <Page title="Progress photos">
      <div className="segmented" role="tablist">
        {POSES.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={pose === p.key}
            className={pose === p.key ? 'on' : ''}
            onClick={() => {
              setPose(p.key)
              setThen(null)
              setNow(null)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="card error">{error}</div>}
      {!photos && !error && <ChartSkeleton height={320} />}

      {photos && ofPose.length === 0 && <p className="muted">No {poseLabel.toLowerCase()} photo yet. Add the first one below.</p>}

      {photos && ofPose.length === 1 && latest && (
        <div className="card">
          <div className="photo-pair single">
            <figure>
              <PhotoImage photo={latest} alt={`${poseLabel}, ${dayLabel(latest.takenOn)}`} />
              <figcaption>{dayLabel(latest.takenOn)}</figcaption>
            </figure>
          </div>
          <p className="muted note">Add another on a later date to compare the two side by side.</p>
        </div>
      )}

      {photos && ofPose.length > 1 && thenPhoto && nowPhoto && (
        <div className="card">
          <div className="photo-pair">
            {(
              [
                ['Then', thenPhoto, setThen],
                ['Now', nowPhoto, setNow],
              ] as const
            ).map(([label, photo, choose]) => (
              <figure key={label}>
                <PhotoImage photo={photo} alt={`${poseLabel}, ${dayLabel(photo.takenOn)}`} />
                <figcaption>
                  <label>
                    <span className="muted">{label}</span>
                    <select value={photo.id} onChange={(e) => choose(e.target.value)}>
                      {ofPose.map((p) => (
                        <option key={p.id} value={p.id}>
                          {dayLabel(p.takenOn)}
                        </option>
                      ))}
                    </select>
                  </label>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <h2>Add a photo</h2>
      <div className="card">
        <label>
          Date
          <input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value || today())} />
        </label>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void picked(e.target.files?.[0])} />
        <button className="primary" disabled={busy || !photos} onClick={() => fileInput.current?.click()}>
          {busy ? 'Saving…' : `Add ${poseLabel.toLowerCase()} photo`}
        </button>
        <p className="muted note">
          Same place, same light and same distance each time make the comparison fair. One photo per day and pose: a new one replaces it.
        </p>
      </div>

      {ofPose.length > 0 && (
        <>
          <h2>All {poseLabel.toLowerCase()} photos</h2>
          <div className="card table photo-list">
            {ofPose.map((p) => (
              <div className="table-row" key={p.id}>
                <span>{dayLabel(p.takenOn)}</span>
                <button className="link danger" onClick={() => void remove(p)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="muted note">Private: the photos are stored in your own database and only you, signed in, can open them. Claude does not see them.</p>
    </Page>
  )
}
