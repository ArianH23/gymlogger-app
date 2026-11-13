import { supabase } from './supabase'

// The CSV itself is built in the database (export_hevy_csv, in the format Hevy imports); this only fetches it and saves it as a file.

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Downloads the file and returns how many sets (rows) it holds. onlyApp: just the workouts logged in the app, not the imported Hevy history. */
export async function downloadHevyExport(onlyApp: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('export_hevy_csv', { p_only_app: onlyApp })
  if (error) throw new Error(error.message)
  const csv = data as string
  const rows = csv.split('\n').length - 1 // the first line is the header
  if (rows <= 0) throw new Error('Nothing to export yet: there are no finished workouts of that kind.')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `gymlogger-for-hevy-${today()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  return rows
}
