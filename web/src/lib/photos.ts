import { supabase } from './supabase'

// Progress photos: a dated front, side and back photo, to compare the same pose over time.
// The files are in a private storage bucket (only their owner can read them); the table progress_photos lists them.

export const POSES = [
  { key: 'front', label: 'Front' },
  { key: 'side', label: 'Side' },
  { key: 'back', label: 'Back' },
] as const
export type Pose = (typeof POSES)[number]['key']

export type Photo = { id: string; takenOn: string; pose: Pose; path: string }

const BUCKET = 'progress-photos'
const MAX_EDGE = 1600 // pixels on the longer side: plenty to compare, and a fraction of what a phone camera saves

/** The size an image gets so that its longer side is at most `max` (never made bigger). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** All photos, newest day first. */
export async function loadPhotos(): Promise<Photo[]> {
  const { data, error } = await supabase.from('progress_photos').select('id, taken_on, pose, path').is('deleted_at', null).order('taken_on', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({ id: r.id as string, takenOn: r.taken_on as string, pose: r.pose as Pose, path: r.path as string }))
}

const urls = new Map<string, { url: string; until: number }>()

/** A link to one photo that works for an hour (the bucket is private, so a plain address would not). */
export async function photoUrl(path: string): Promise<string> {
  const hit = urls.get(path)
  if (hit && hit.until > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) throw error
  urls.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 })
  return data.signedUrl
}

/** The picked image as a JPEG no bigger than 1600 px on its longer side (upright, as the camera meant it). */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const { width, height } = fitWithin(image.width, image.height, MAX_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(image, 0, 0, width, height)
  image.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('Could not read that image.')
  return { blob, width, height }
}

/** Removes a photo: the row is marked deleted and the file is erased. */
export async function deletePhoto(photo: Photo) {
  const { error } = await supabase.from('progress_photos').update({ deleted_at: new Date().toISOString() }).eq('id', photo.id)
  if (error) throw error
  urls.delete(photo.path)
  await supabase.storage.from(BUCKET).remove([photo.path]) // best effort: the row is gone either way
}

/** Saves a photo for a day and a pose. One per day and pose: an earlier one for the same day and pose is replaced. */
export async function addPhoto(file: File, pose: Pose, takenOn: string, existing: Photo[]): Promise<Photo> {
  const { data: auth } = await supabase.auth.getSession()
  const userId = auth.session?.user.id
  if (!userId) throw new Error('You are signed out.')
  const { blob, width, height } = await shrink(file)

  for (const old of existing.filter((p) => p.pose === pose && p.takenOn === takenOn)) await deletePhoto(old)

  const id = crypto.randomUUID()
  const path = `${userId}/${id}.jpg`
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (up.error) throw up.error
  const { error } = await supabase.from('progress_photos').insert({ id, taken_on: takenOn, pose, path, width, height })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]) // do not leave a file nobody lists
    throw error
  }
  return { id, takenOn, pose, path }
}
