import { supabase } from './supabase.js'

export async function fetchProjects({ includeArchived = false } = {}) {
  let q = supabase.from('projects').select('id, name, code, colour, budget_hours, billable, counts_toward_target, status, client:clients(id, name, colour, is_internal)').order('name')
  if (!includeArchived) q = q.eq('status', 'active')
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((p) => ({ ...p, colour: p.colour || p.client?.colour || '#487BFA' }))
}

export async function fetchWorkTypes(all = false) {
  let q = supabase.from('work_types').select('*').order('sort_order').order('name')
  if (!all) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function fetchMyAllocations(uid) {
  const { data, error } = await supabase.from('allocations').select('project_id, hours').eq('profile_id', uid)
  if (error) throw error
  return data || []
}

export async function fetchMyProjectTotals() {
  // Own hours per project, all time, summed on the server
  const { data, error } = await supabase.rpc('my_project_totals')
  if (error) throw error
  const m = {}
  ;(data || []).forEach((r) => { m[r.project_id] = Number(r.hours) })
  return m
}

export async function fetchWeekEntries(uid, weekStart, weekEnd) {
  const { data, error } = await supabase.from('time_entries')
    .select('id, project_id, work_type_id, entry_date, hours, note, source, sort_order, start_time')
    .eq('profile_id', uid).gte('entry_date', weekStart).lte('entry_date', weekEnd)
    .order('start_time').order('created_at')
  if (error) throw error
  return data || []
}

export async function fetchPendingSuggestions(uid) {
  const { data, error } = await supabase.from('calendar_suggestions').select('*').eq('profile_id', uid).eq('status', 'pending').order('starts_at')
  if (error) throw error
  return data || []
}

// The database stores whole minutes (hours is derived from it), so anything the app
// writes as hours is converted here. Everything read back still has hours on it.
function toRow(row) {
  const r = { ...row }
  if ('hours' in r) { r.minutes = Math.max(1, Math.round(Number(r.hours) * 60)); delete r.hours }
  return r
}
export async function insertEntry(row) {
  const { data, error } = await supabase.from('time_entries').insert(toRow(row)).select().single()
  if (error) throw error
  return data
}
export async function updateEntry(id, patch) {
  const { data, error } = await supabase.from('time_entries').update(toRow(patch)).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteEntry(id) {
  const { error } = await supabase.from('time_entries').delete().eq('id', id)
  if (error) throw error
}

export function downloadCSV(filename, rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(',')).join('\n')
  const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
