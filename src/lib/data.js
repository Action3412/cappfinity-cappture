import { supabase } from './supabase.js'

export async function fetchProjects({ includeArchived = false } = {}) {
  let q = supabase.from('projects').select('id, name, code, colour, budget_hours, billable, status, client:clients(id, name, colour, is_internal)').order('name')
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

export async function fetchMyProjectTotals(uid) {
  // Own hours per project, all time (members can only read their own rows anyway)
  const { data, error } = await supabase.from('time_entries').select('project_id, hours').eq('profile_id', uid)
  if (error) throw error
  const m = {}
  ;(data || []).forEach((r) => { m[r.project_id] = (m[r.project_id] || 0) + Number(r.hours) })
  return m
}

export async function fetchWeekEntries(uid, weekStart, weekEnd) {
  const { data, error } = await supabase.from('time_entries')
    .select('id, project_id, work_type_id, entry_date, hours, note, source, sort_order')
    .eq('profile_id', uid).gte('entry_date', weekStart).lte('entry_date', weekEnd)
    .order('sort_order').order('created_at')
  if (error) throw error
  return data || []
}

export async function fetchPendingSuggestions(uid) {
  const { data, error } = await supabase.from('calendar_suggestions').select('*').eq('profile_id', uid).eq('status', 'pending').order('starts_at')
  if (error) throw error
  return data || []
}

export async function insertEntry(row) {
  const { data, error } = await supabase.from('time_entries').insert(row).select().single()
  if (error) throw error
  return data
}
export async function updateEntry(id, patch) {
  const { data, error } = await supabase.from('time_entries').update(patch).eq('id', id).select().single()
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
