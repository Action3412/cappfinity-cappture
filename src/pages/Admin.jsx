import { useEffect, useMemo, useState } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { supabase } from '../lib/supabase.js'
import { fmtHours, timeAgo, fmtDateTime } from '../lib/time.js'
import { initials } from '../components/Shell.jsx'
import { X } from '../components/Icons.jsx'
import Hint from '../components/Hint.jsx'
import SortTh, { useSort } from '../components/SortTh.jsx'

const COLOURS = ['#487BFA', '#9275FA', '#FB6CF5', '#FDB601', '#2BB3A3', '#F08A4B', '#5C6BC0', '#26A69A']
const AVATARS = ['#FDE9A8', '#D8CFFE', '#FED3FB', '#C9D6FD', '#DDEFE5', '#F6D5C9']
const av = (n = '') => AVATARS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]

function useToast() { const [t, setT] = useState(''); return [t, (m) => { setT(m); setTimeout(() => setT(''), 2500) }] }

export default function Admin() {
  const [counts, setCounts] = useState({})
  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('work_types').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('active', true),
    ]).then(([p, w, u]) => setCounts({ projects: p.count, workTypes: w.count, people: u.count }))
  }, [])
  const tabs = [
    { to: 'projects', label: 'Client projects', count: counts.projects },
    { to: 'work-types', label: 'Work types', count: counts.workTypes },
    { to: 'people', label: 'People', count: counts.people },
    { to: 'settings', label: 'Week & reminders', count: '' },
  ]
  return (
    <div className="page admin-layout">
      <aside className="admin-nav">
        <h1 style={{ marginBottom: 10 }}>Admin</h1>
        {tabs.map((t) => <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'on' : '')} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 42, padding: '0 14px', borderRadius: 10, fontWeight: 600, fontSize: 14, color: 'inherit' }}>
          <span>{t.label}</span><span className="small" style={{ opacity: .7 }}>{t.count ?? ''}</span></NavLink>)}
      </aside>
      <main className="admin-main">
        <Routes>
          <Route index element={<Navigate to="projects" replace />} />
          <Route path="projects" element={<Projects />} />
          <Route path="work-types" element={<WorkTypes />} />
          <Route path="people" element={<People />} />
          <Route path="settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ Projects */
function Projects() {
  const { profile } = useAuth()
  const [clients, setClients] = useState([])
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [allocs, setAllocs] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [form, setForm] = useState({ client: '', name: '', code: '', budget: '', billable: true })
  const [allocFor, setAllocFor] = useState(null)
  const [editing, setEditing] = useState(null)
  const sort = useSort('client')
  const [q, setQ] = useState('')
  const [fClient, setFClient] = useState('all')
  const [fBill, setFBill] = useState('all')
  const [toast, flash] = useToast()

  async function load() {
    const [c, p, u, a] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('projects').select('*, client:clients(id,name,colour,is_internal)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, email, team_id, teams(name)').eq('active', true).order('full_name'),
      supabase.from('allocations').select('*'),
    ])
    setClients(c.data || []); setProjects(p.data || []); setPeople(u.data || []); setAllocs(a.data || [])
  }
  useEffect(() => { load() }, [])

  const allocByProject = useMemo(() => { const m = {}; allocs.forEach((a) => { (m[a.project_id] ||= []).push(a) }); return m }, [allocs])

  async function addProject(e) {
    e.preventDefault()
    const clientName = form.client.trim(), name = form.name.trim()
    if (!clientName || !name) return
    let client = clients.find((c) => c.name.toLowerCase() === clientName.toLowerCase())
    if (!client) {
      const { data, error } = await supabase.from('clients').insert({ name: clientName, colour: COLOURS[clients.length % COLOURS.length] }).select().single()
      if (error) { flash(error.message); return }
      client = data
    }
    const code = (form.code.trim() || suggestCode(clientName, name)).toUpperCase()
    const { error } = await supabase.from('projects').insert({ client_id: client.id, name, code, budget_hours: Number(form.budget) || 0, billable: form.billable, created_by: profile.id })
    if (error) { flash(error.code === '23505' ? `Code ${code} is already in use` : error.message); return }
    setForm({ client: '', name: '', code: '', budget: '', billable: true }); flash(`Added ${name}`); load()
  }
  async function toggleArchive(p) {
    const status = p.status === 'active' ? 'archived' : 'active'
    const { error } = await supabase.from('projects').update({ status }).eq('id', p.id)
    if (error) flash(error.message); else load()
  }
  async function updateBudget(p, v) {
    const { error } = await supabase.from('projects').update({ budget_hours: Number(v) || 0 }).eq('id', p.id)
    if (error) flash(error.message); else setProjects((ps) => ps.map((x) => (x.id === p.id ? { ...x, budget_hours: Number(v) || 0 } : x)))
  }

  const list = projects
    .filter((p) => showArchived || p.status === 'active')
    .filter((p) => fClient === 'all' || p.client_id === fClient)
    .filter((p) => fBill === 'all' || (fBill === 'yes') === !!p.billable)
    .filter((p) => !q.trim() || `${p.name} ${p.code} ${p.client?.name}`.toLowerCase().includes(q.trim().toLowerCase()))
  const filtering = q.trim() || fClient !== 'all' || fBill !== 'all'
  const sorted = sort.sortBy(list, {
    client: (p) => `${p.client?.name || ''} ${p.name}`,
    project: (p) => p.name,
    code: (p) => p.code,
    budget: (p) => Number(p.budget_hours) || 0,
    allocated: (p) => (allocByProject[p.id] || []).length,
    status: (p) => p.status,
  })
  async function saveEdit(p, fields) {
    const patch = { ...fields }
    if (fields.clientName !== undefined) {
      const name = fields.clientName.trim(); delete patch.clientName
      let client = clients.find((c) => c.name.toLowerCase() === name.toLowerCase())
      if (!client && name) {
        const { data, error } = await supabase.from('clients').insert({ name, colour: COLOURS[clients.length % COLOURS.length] }).select().single()
        if (error) { flash(error.message); return false }
        client = data
      }
      if (client) patch.client_id = client.id
    }
    const { error } = await supabase.from('projects').update(patch).eq('id', p.id)
    if (error) { flash(error.code === '23505' ? 'That code is already in use' : error.message); return false }
    flash('Saved'); load(); return true
  }
  const autoCode = form.client && form.name ? suggestCode(form.client, form.name) : ''

  return (
    <>
      <section className="panel panel-b col" style={{ gap: 12 }}>
        <h2>Add a client project<Hint title="Client projects" text="A project is anything people log time against. Usually it's a piece of client work, but you can add internal things too (set them to non-billable). Each project belongs to a client. If the client isn't in the list yet, just type the name and it's created." /></h2>
        <form onSubmit={addProject} className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <label className="field">Client
            <input className="input" list="clients" placeholder="e.g. Aviva" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} required />
            <datalist id="clients">{clients.filter((c) => !c.is_internal).map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </label>
          <label className="field">Project name<input className="input" placeholder="e.g. Early Careers Refresh" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="field"><span className="row" style={{ gap: 4 }}>Code<Hint title="Project code" text="A short tag like AVI-EC. It appears on people's project cards and in exports, and later on it's how Outlook meetings get matched to the project: put the code anywhere in a meeting subject and it links up. Leave it blank and we'll suggest one." /></span><input className="input" placeholder={autoCode || 'AVI-EC'} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} style={{ textTransform: 'uppercase' }} /></label>
          <label className="field"><span className="row" style={{ gap: 4 }}>Budget (hours)<Hint title="Budget" text="The total hours this project has been sold or planned for, across everyone. It drives the progress bars and On track / Nearly out / Over status in Reports. Leave it at 0 if there isn't one." /></span><input className="input" type="number" min="0" step="0.5" placeholder="pool, e.g. 120" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></label>
          <label className="field"><span className="row" style={{ gap: 4 }}>Billable<Hint title="Billable" text="Billable means it's chargeable client work and counts towards someone's billable share. Non-billable is for internal things like pitches, admin and learning. Both count towards the 37.5 hour week." /></span><select className="select" value={form.billable ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, billable: e.target.value === 'yes' })}><option value="yes">Billable</option><option value="no">Non-billable</option></select></label>
          <button className="btn primary" type="submit" style={{ height: 38 }}>Add project</button>
        </form>
        <span className="small muted">Type a new client name and it gets created on the spot. Keep the code short and memorable. It's what people can put in Outlook meeting subjects so meetings match up automatically later on.</span>
      </section>

      <section className="panel" style={{ overflow: 'hidden' }}>
        <div className="panel-h" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h2>Client projects <span className="small muted" style={{ fontWeight: 500 }}>{list.length}{filtering ? ` of ${projects.filter((p) => showArchived || p.status === 'active').length}` : ''}</span></h2>
          <div className="filterbar" role="group" aria-label="Project filters">
            <label className="filter find"><span>Search</span><input type="search" placeholder="Name, code or client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" /></label>
            <label className="filter"><span>Client</span><select value={fClient} onChange={(e) => setFClient(e.target.value)}><option value="all">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="filter"><span>Type</span><select value={fBill} onChange={(e) => setFBill(e.target.value)}><option value="all">Billable and not</option><option value="yes">Billable only</option><option value="no">Non-billable only</option></select></label>
            <label className="filter toggle"><span>Archived</span><span className="row" style={{ gap: 6, height: 22 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /><span style={{ fontSize: 13, fontWeight: 600 }}>{showArchived ? 'Shown' : 'Hidden'}</span></span></label>
            {filtering && <button type="button" className="filter-clear" onClick={() => { setQ(''); setFClient('all'); setFBill('all') }}>Clear</button>}
          </div>
        </div>
        <div className="scroll-x">
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead><tr>
              <SortTh k="client" sort={sort}>Client</SortTh>
              <SortTh k="project" sort={sort}>Project</SortTh>
              <SortTh k="code" sort={sort}>Code</SortTh>
              <SortTh k="budget" sort={sort} align="right">Budget<Hint align="right" title="Budget" text="Total hours for the project. Edit it here and it saves when you click away." /></SortTh>
              <SortTh k="allocated" sort={sort} align="right">Allocated<Hint align="right" title="Allocated" text="Who's on the project, set with the Team button, and the hours you expect from them if you've given any. Anyone can still log time whether or not they're on it; being on it just puts the project at the top of their list, and an hours estimate gives them a little budget bar to track against." /></SortTh>
              <SortTh k="status" sort={sort}>Status<Hint title="Status" text="Archiving takes a project off everyone's list so no more time can be logged to it, but keeps every hour already logged in reports and exports. Restore brings it back." /></SortTh>
              <th /></tr></thead>
            <tbody>
              {sorted.map((p) => {
                const al = allocByProject[p.id] || []
                return (
                  <tr key={p.id} className="click" style={{ opacity: p.status === 'archived' ? .55 : 1 }} onClick={() => setEditing(p)} title="Click to edit">
                    <td><div className="row"><span className="swatch" style={{ background: p.colour || p.client?.colour }} /><b>{p.client?.name}</b></div></td>
                    <td>{p.name}{!p.billable && <span className="tag grey" style={{ marginLeft: 8 }}>non-billable</span>}</td>
                    <td className="small muted">{p.code}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}><input className="input" type="number" min="0" step="0.5" defaultValue={p.budget_hours} onBlur={(e) => Number(e.target.value) !== Number(p.budget_hours) && updateBudget(p, e.target.value)} style={{ width: 84, height: 32, textAlign: 'right' }} aria-label="Budget hours" /></td>
                    <td className="num">{al.length ? `${al.length} ${al.length === 1 ? 'person' : 'people'}${al.some((x) => x.hours) ? ` · ${al.reduce((a, x) => a + (Number(x.hours) || 0), 0)}h` : ''}` : <span className="muted">nobody yet</span>}</td>
                    <td><span className={`tag ${p.status === 'active' ? 'ok' : 'grey'}`}>{p.status === 'active' ? 'Active' : 'Archived'}</span></td>
                    <td className="num" onClick={(e) => e.stopPropagation()}><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button className="btn sm" onClick={() => setEditing(p)}>Edit</button>
                      <button className="btn sm" onClick={() => setAllocFor(p)}>Team</button>
                      <button className="btn sm" onClick={() => toggleArchive(p)}>{p.status === 'active' ? 'Archive' : 'Restore'}</button>
                    </div></td>
                  </tr>
                )
              })}
              {!list.length && <tr><td colSpan="7" className="center">{filtering ? 'Nothing matches those filters.' : 'No projects yet. Add the first one above.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editing && <EditProjectModal project={editing} clients={clients} onSave={(fields) => saveEdit(editing, fields)} onClose={() => setEditing(null)} />}
      {allocFor && <AllocateModal project={allocFor} people={people} allocs={allocByProject[allocFor.id] || []} onClose={() => { setAllocFor(null); load() }} flash={flash} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

function EditProjectModal({ project, clients, onSave, onClose }) {
  const [f, setF] = useState({ clientName: project.client?.name || '', name: project.name, code: project.code, budget_hours: project.budget_hours, billable: project.billable, colour: project.colour || '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  async function submit(e) {
    e.preventDefault(); setBusy(true)
    const ok = await onSave({ clientName: f.clientName, name: f.name.trim(), code: f.code.trim().toUpperCase(), budget_hours: Number(f.budget_hours) || 0, billable: f.billable, colour: f.colour || null })
    setBusy(false); if (ok) onClose()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(38,38,38,.45)', display: 'grid', placeItems: 'center', zIndex: 40, padding: 20 }} onClick={onClose}>
      <form className="panel col" style={{ width: '100%', maxWidth: 560, gap: 0 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="panel-h"><h2>Edit project</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X /></button></div>
        <div className="panel-b col" style={{ gap: 12 }}>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="field">Client
              <input className="input" list="edit-clients" value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} required />
              <datalist id="edit-clients">{clients.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            </label>
            <label className="field">Project name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
            <label className="field">Code<input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required style={{ textTransform: 'uppercase' }} /></label>
            <label className="field">Budget (hours)<input className="input" type="number" min="0" step="0.5" value={f.budget_hours} onChange={(e) => setF({ ...f, budget_hours: e.target.value })} /></label>
            <label className="field">Billable<select className="select" value={f.billable ? 'yes' : 'no'} onChange={(e) => setF({ ...f, billable: e.target.value === 'yes' })}><option value="yes">Billable</option><option value="no">Non-billable</option></select></label>
            <label className="field">Colour on the board
              <div className="row wrap" style={{ gap: 6, paddingTop: 4 }}>
                <button type="button" className={`pill ${!f.colour ? 'on' : ''}`} onClick={() => setF({ ...f, colour: '' })} title="Use the client's colour">Client's</button>
                {COLOURS.map((c) => <button type="button" key={c} aria-label={`Colour ${c}`} onClick={() => setF({ ...f, colour: c })} style={{ width: 26, height: 26, borderRadius: 8, border: f.colour === c ? '2px solid var(--charcoal)' : '2px solid transparent', background: c, cursor: 'pointer' }} />)}
              </div>
            </label>
          </div>
          <span className="small muted">Changing the client moves the project under that client; typing a new client name creates it. Changing the code is safe, every hour already logged stays attached.</span>
        </div>
        <div className="row between" style={{ padding: '12px 18px', borderTop: '1px solid var(--line-soft)' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      </form>
    </div>
  )
}

function suggestCode(client, name) {
  const c = client.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase()
  const n = name.split(/\s+/).map((w) => w[0]).join('').replace(/[^a-z]/gi, '').slice(0, 4).toUpperCase()
  return c && n ? `${c}-${n}` : ''
}

function AllocateModal({ project, people, allocs, onClose, flash }) {
  const [rows, setRows] = useState(() => people.map((u) => {
    const a = allocs.find((x) => x.profile_id === u.id)
    return { ...u, on: !!a, hours: a?.hours ?? '' }
  }))
  const [q, setQ] = useState('')
  const visible = rows.filter((r) => !q || `${r.full_name} ${r.email} ${r.teams?.name}`.toLowerCase().includes(q.toLowerCase()))
  const onRows = rows.filter((r) => r.on)
  const total = onRows.reduce((a, r) => a + (Number(r.hours) || 0), 0)
  const noEstimate = onRows.filter((r) => !(Number(r.hours) > 0)).length
  const set = (id, f) => setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...f } : x)))

  async function save() {
    const keep = onRows.map((r) => ({ project_id: project.id, profile_id: r.id, hours: Number(r.hours) > 0 ? Number(r.hours) : null }))
    const drop = rows.filter((r) => !r.on && allocs.some((a) => a.profile_id === r.id)).map((r) => r.id)
    if (drop.length) await supabase.from('allocations').delete().eq('project_id', project.id).in('profile_id', drop)
    if (keep.length) { const { error } = await supabase.from('allocations').upsert(keep, { onConflict: 'project_id,profile_id' }); if (error) { flash(error.message); return } }
    flash('Team saved'); onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(38,38,38,.45)', display: 'grid', placeItems: 'center', zIndex: 40, padding: 20 }} onClick={onClose}>
      <div className="panel col" style={{ width: '100%', maxWidth: 600, maxHeight: '85vh', gap: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-h">
          <div className="col" style={{ gap: 2 }}>
            <h2>Who's on {project.name}<Hint title="Allocating" text="Tick someone to put them on the project: it goes to the top of their list and shows up under Mine. If you also have a view on how long they should spend, add the hours and they get a little budget bar to track against. Leave the hours blank if you just want them on it." /></h2>
            <span className="small muted">{onRows.length} {onRows.length === 1 ? 'person' : 'people'} · {total ? `${total}h estimated` : 'no hours estimated'}{noEstimate && total ? ` · ${noEstimate} without an estimate` : ''}{project.budget_hours && total > project.budget_hours ? ' · over the project budget' : ''}</span>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <div className="panel-b col" style={{ gap: 6, overflow: 'auto' }}>
          <input className="input" placeholder="Find a person…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="row between tiny label" style={{ padding: '8px 4px 2px' }}><span>Person</span><span style={{ width: 170, textAlign: 'right' }}>Hours expected (optional)</span></div>
          {visible.map((r) => (
            <label className="row" key={r.id} style={{ gap: 10, padding: '7px 4px', borderBottom: '1px dotted var(--line)', cursor: 'pointer', background: r.on ? '#F7F6FD' : 'transparent', borderRadius: 8 }}>
              <input type="checkbox" checked={r.on} onChange={(e) => set(r.id, { on: e.target.checked })} aria-label={`${r.full_name || r.email} on this project`} />
              <span className="avatar sm" style={{ background: av(r.full_name || r.email) }}>{initials(r.full_name || r.email)}</span>
              <div className="col grow" style={{ gap: 0, minWidth: 0 }}><b className="small">{r.full_name || r.email}</b><span className="tiny muted">{r.teams?.name || 'No team'}</span></div>
              {r.on
                ? <span className="row" style={{ gap: 6 }}><input className="input" type="number" min="0.5" step="0.5" placeholder="no estimate" value={r.hours} onChange={(e) => set(r.id, { hours: e.target.value })} onClick={(e) => e.preventDefault()} style={{ width: 120, height: 32, textAlign: 'right' }} aria-label={`Hours for ${r.full_name}`} /><span className="small muted" style={{ width: 14 }}>h</span></span>
                : <span className="tiny muted" style={{ width: 140, textAlign: 'right' }}>not on project</span>}
            </label>
          ))}
          {!people.length && <span className="small muted">No active people yet.</span>}
        </div>
        <div className="row between" style={{ padding: '12px 18px', borderTop: '1px solid var(--line-soft)' }}><span className="small muted">Anyone can still log time to the project whether or not they're on it. Being on it just puts it at the top of their list.</span><button className="btn primary" onClick={save}>Save</button></div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Work types */
function WorkTypes() {
  const [types, setTypes] = useState([])
  const [usage, setUsage] = useState({})
  const [name, setName] = useState('')
  const [chunks, setChunks] = useState([])
  const [toast, flash] = useToast()

  async function load() {
    const [t, e, s] = await Promise.all([
      supabase.from('work_types').select('*').order('sort_order').order('name'),
      supabase.from('time_entries').select('work_type_id, hours'),
      supabase.from('settings').select('value').eq('key', 'duration_chunks').maybeSingle(),
    ])
    setTypes(t.data || []); setChunks(Array.isArray(s.data?.value) ? s.data.value : [])
    const u = {}; (e.data || []).forEach((r) => { u[r.work_type_id] = (u[r.work_type_id] || 0) + Number(r.hours) }); setUsage(u)
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault(); const n = name.trim(); if (!n) return
    const { error } = await supabase.from('work_types').insert({ name: n, sort_order: types.length + 1, colour: COLOURS[types.length % COLOURS.length] })
    if (error) flash(error.code === '23505' ? 'That work type already exists' : error.message); else { setName(''); load() }
  }
  async function setActive(t, active) { await supabase.from('work_types').update({ active }).eq('id', t.id); load() }
  async function move(t, dir) {
    const act = types.filter((x) => x.active); const i = act.findIndex((x) => x.id === t.id); const j = i + dir
    if (j < 0 || j >= act.length) return
    const a = act[i], b = act[j]
    await Promise.all([supabase.from('work_types').update({ sort_order: j + 1 }).eq('id', a.id), supabase.from('work_types').update({ sort_order: i + 1 }).eq('id', b.id)])
    load()
  }

  const active = types.filter((t) => t.active), hidden = types.filter((t) => !t.active)
  return (
    <>
      <section className="panel panel-b col" style={{ gap: 14 }}>
        <div className="col" style={{ gap: 4 }}><h2>Work types<Hint title="Work types" text="The categories people tag their time with, like Analysis or QA. Reports break time down by these, so keep them broad enough that people don't have to think. Use the arrows to change the order they appear in." /></h2><span className="small muted">These are the pills people tap when logging time. Keep it to eight or fewer so they fit on one row.</span></div>
        <div className="row wrap" style={{ gap: 8 }}>
          {active.map((t, i) => (
            <span key={t.id} className="row" style={{ height: 36, padding: '0 6px 0 14px', borderRadius: 999, border: '1.5px solid var(--line)', background: '#fff', fontSize: 13, fontWeight: 600, gap: 8 }}>
              <span className="swatch" style={{ background: t.colour, borderRadius: '50%', width: 8, height: 8 }} />{t.name}
              <span className="tiny muted" style={{ fontWeight: 500 }}>{usage[t.id] ? fmtHours(usage[t.id]) : 'new'}</span>
              <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Move left" onClick={() => move(t, -1)} disabled={i === 0}>‹</button>
              <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Move right" onClick={() => move(t, 1)} disabled={i === active.length - 1}>›</button>
              <button className="icon-btn" style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--bg)' }} aria-label={`Hide ${t.name}`} onClick={() => setActive(t, false)}><X /></button>
            </span>
          ))}
        </div>
        <form onSubmit={add} className="row" style={{ maxWidth: 420 }}><input className="input" placeholder="New work type, e.g. Facilitation" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn primary" type="submit" style={{ height: 38 }}>Add</button></form>
        {hidden.length > 0 && <div className="col" style={{ gap: 6 }}><span className="label">Hidden (history kept)</span><div className="row wrap" style={{ gap: 6 }}>{hidden.map((t) => <button key={t.id} className="pill" onClick={() => setActive(t, true)} title="Restore">{t.name} · restore</button>)}</div></div>}
        <div className="note">Hiding a type takes it out of the picker but every hour already logged against it stays in the reports.</div>
      </section>
      <section className="panel panel-b col" style={{ gap: 10 }}>
        <h2>Time chunks<Hint title="Time chunks" text="The quick-pick buttons on each entry. Most time fits one of these. Anything that doesn't can be typed in, so you don't need a chunk for every possibility." /></h2><span className="small muted">These are the duration pills. A working day is 7.5h, so a half day is 3.75h and five full days make the week. Anything else can be typed into the box next to them.</span>
        <div className="row wrap" style={{ gap: 8 }}>{chunks.map((c) => <span key={c.label} className="pill" style={{ cursor: 'default', display: 'inline-flex', alignItems: 'center' }}>{c.label} · {c.hours}h</span>)}</div>
        <span className="tiny muted">You can edit these under Week &amp; reminders if the working day ever changes.</span>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

/* ------------------------------------------------------------------ People */
function People() {
  const { profile: me } = useAuth()
  const [people, setPeople] = useState([])
  const [invites, setInvites] = useState([])
  const [teams, setTeams] = useState([])
  const [weeks, setWeeks] = useState({})
  const [activity, setActivity] = useState({})
  const psort = useSort('name')
  const [, setTick] = useState(0)
  const [inv, setInv] = useState({ email: '', full_name: '', team_id: '', role: 'member', manager_id: '' })
  const [issued, setIssued] = useState(null) // { name, email, password, kind }
  const [busy, setBusy] = useState(false)
  const [newTeam, setNewTeam] = useState('')
  const [q, setQ] = useState('')
  const [toast, flash] = useToast()

  async function load() {
    const [p, i, t, w, a] = await Promise.all([
      supabase.from('profiles').select('*, teams(name)').order('full_name'),
      supabase.from('invites').select('*').is('accepted_at', null).order('created_at', { ascending: false }),
      supabase.from('teams').select('*').order('name'),
      supabase.rpc('week_shortfalls', { p_week_start: lastWeekStart() }),
      supabase.rpc('people_activity'),
    ])
    setPeople(p.data || []); setInvites(i.data || []); setTeams(t.data || [])
    const am = {}; (a.data || []).forEach((r) => { am[r.profile_id] = r }); setActivity(am)
    const m = {}; (w.data || []).forEach((r) => { m[r.profile_id] = { logged: Number(r.logged_hours), short: Number(r.shortfall) } }); setWeeks(m)
  }
  useEffect(() => { load(); const i = setInterval(() => { load(); setTick((x) => x + 1) }, 60000); return () => clearInterval(i) }, [])

  async function callAdmin(payload) {
    const { data, error } = await supabase.functions.invoke('admin-users', { body: payload })
    if (error) {
      let msg = error.message
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    if (data?.error) throw new Error(data.error)
    return data
  }
  async function sendInvite(e) {
    e.preventDefault(); const email = inv.email.trim().toLowerCase(); if (!email) return
    setBusy(true)
    try {
      const r = await callAdmin({ action: 'invite', email, full_name: inv.full_name.trim(), team_id: inv.team_id || null, role: inv.role, manager_id: inv.manager_id || null })
      setIssued({ kind: 'invite', name: inv.full_name.trim() || email, email: r.email, password: r.password })
      setInv({ email: '', full_name: '', team_id: '', role: 'member', manager_id: '' }); load()
    } catch (ex) { flash(ex.message) } finally { setBusy(false) }
  }
  async function resetPassword(u) {
    if (!confirm(`Give ${u.full_name || u.email} a new temporary password? Their current one stops working.`)) return
    try {
      const r = await callAdmin({ action: 'reset-password', profile_id: u.id })
      setIssued({ kind: 'reset', name: u.full_name || u.email, email: r.email, password: r.password })
    } catch (ex) { flash(ex.message) }
  }
  async function patch(u, f) {
    const { error } = await supabase.from('profiles').update(f).eq('id', u.id)
    if (error) flash(error.message); else load()
  }
  async function addTeam(e) {
    e.preventDefault(); const n = newTeam.trim(); if (!n) return
    const { error } = await supabase.from('teams').insert({ name: n }); if (error) flash(error.message); else { setNewTeam(''); load() }
  }
  async function cancelInvite(i) { await supabase.from('invites').delete().eq('id', i.id); load() }

  const list = people.filter((u) => !q || `${u.full_name} ${u.email} ${u.teams?.name}`.toLowerCase().includes(q.toLowerCase()))
  const byId = Object.fromEntries(people.map((u) => [u.id, u]))
  const activeSorted = psort.sortBy(list.filter((u) => u.active), {
    name: (u) => u.full_name || u.email,
    team: (u) => u.teams?.name || '',
    role: (u) => ({ admin: 0, manager: 1, member: 2 })[u.role],
    manager: (u) => byId[u.manager_id]?.full_name || '',
    target: (u) => Number(u.weekly_target),
    week: (u) => (weeks[u.id] ? Number(weeks[u.id].short) : -1),
    activity: (u) => activity[u.id]?.last_seen_at || activity[u.id]?.last_sign_in_at || '',
  })
  const pending = list.filter((u) => !u.active)
  return (
    <>
      <section className="panel panel-b col" style={{ gap: 12 }}>
        <h2>Invite someone<Hint title="Inviting people" text="Add their name, work email, team and role and their account is created straight away with a one-time password for you to pass on. Member: logs their own time. Manager: also sees Reports for their team and can send reminders. Admin: everything, including this page." /></h2>
        <form onSubmit={sendInvite} className="form-grid" style={{ gridTemplateColumns: 'minmax(140px, 1.3fr) minmax(180px, 1.8fr) minmax(120px, 1fr) minmax(100px, .9fr) minmax(140px, 1.2fr) auto' }}>
          <label className="field">Name<input className="input" required placeholder="e.g. Beth Wilson" value={inv.full_name} onChange={(e) => setInv({ ...inv, full_name: e.target.value })} /></label>
          <label className="field">Work email<input className="input" type="email" required placeholder="name@cappfinity.com" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></label>
          <label className="field">Team<select className="select" value={inv.team_id} onChange={(e) => setInv({ ...inv, team_id: e.target.value })}><option value="">No team yet</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="field">Role<select className="select" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}><option value="member">Member</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
          <label className="field">Reports to<select className="select" value={inv.manager_id} onChange={(e) => setInv({ ...inv, manager_id: e.target.value })}><option value="">Nobody yet</option>{people.filter((u) => u.active && u.role !== 'member').map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}</select></label>
          <button className="btn primary" type="submit" style={{ height: 38 }} disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <span className="small muted">This creates their account on the spot and gives you a one-time password to pass on (Teams is fine). No email links, which Outlook's link scanner tends to break. They sign in with the password, then set their own from the menu under their name.</span>
        {issued && (
          <div className="issued">
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div className="col" style={{ gap: 2 }}>
                <b>{issued.kind === 'invite' ? `${issued.name} is set up` : `New temporary password for ${issued.name}`}</b>
                <span className="small" style={{ opacity: .75 }}>Shown once. Copy it now and send it to them; it isn't stored anywhere you can get it back.</span>
              </div>
              <button className="icon-btn" aria-label="Dismiss" onClick={() => setIssued(null)} style={{ color: '#fff' }}><X /></button>
            </div>
            <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
              <code className="issued-pw">{issued.password}</code>
              <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(issued.password); flash('Password copied') }}>Copy password</button>
              <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(`Hi ${issued.name.split(' ')[0]}, I've set you up on Cappture, our new time-logging tool.\n\nSign in here: ${window.location.origin}\nEmail: ${issued.email}\nTemporary password: ${issued.password}\n\nUse "I have a password" on the sign-in page, then set your own password from the menu under your name (top right). Takes a minute.`); flash('Message copied, paste it into Teams') }}>Copy Teams message</button>
            </div>
          </div>
        )}
        {invites.length > 0 && <div className="col" style={{ gap: 4 }}><span className="label">Invited, not yet signed in</span>{invites.map((i) => <div className="row between small" key={i.id} style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>{i.email} <span className="muted">· {i.role}</span></span><button className="btn sm ghost danger" onClick={() => cancelInvite(i)}>Cancel</button></div>)}</div>}
      </section>

      {pending.length > 0 && (
        <section className="panel panel-b col" style={{ gap: 8, borderColor: 'var(--gold)' }}>
          <h2>Waiting for approval</h2><span className="small muted">These people signed in from an address outside the allowed domains. Approve them to let them in.</span>
          {pending.map((u) => <div className="row between" key={u.id} style={{ padding: '6px 0', borderBottom: '1px dotted var(--line)' }}><span className="small"><b>{u.full_name}</b> · {u.email}</span><div className="row"><button className="btn sm primary" onClick={() => patch(u, { active: true })}>Approve</button></div></div>)}
        </section>
      )}

      <section className="panel" style={{ overflow: 'hidden' }}>
        <div className="panel-h" style={{ flexWrap: 'wrap', gap: 10 }}><h2>People <span className="small muted" style={{ fontWeight: 500 }}>{people.filter((u) => u.active).length} active</span></h2><div className="filterbar" role="group" aria-label="People filters"><label className="filter find"><span>Search</span><input type="search" placeholder="Name, email or team…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" /></label></div></div>
        <div className="scroll-x">
          <table className="tbl" style={{ minWidth: 1000 }}>
            <thead><tr>
              <SortTh k="name" sort={psort}>Name</SortTh>
              <SortTh k="team" sort={psort}>Team<Hint title="Team" text="Which team someone sits in. It's a grouping for Reports (filter by team); who can see whose time is set by Reports to." /></SortTh>
              <SortTh k="role" sort={psort}>Role<Hint title="Role" text="Member: logs their own time. Manager: also sees the time of people who report to them, in Reports, and can chase them. Admin: can do everything, including add projects and people. You can't change your own role, to stop you locking yourself out." /></SortTh>
              <SortTh k="manager" sort={psort}>Reports to<Hint title="Reports to" text="Their line manager. This decides whose time a manager can see and chase, and who gets copied on the Monday reminder. Only managers and admins appear in the list." /></SortTh>
              <SortTh k="target" sort={psort} align="right">Target<Hint align="right" title="Weekly target" text="Hours this person is expected to log each week. 37.5 for full time. Set it lower for part-timers so they aren't flagged as short every week." /></SortTh>
              <SortTh k="week" sort={psort} align="right">Last week<Hint align="right" title="Last week" text="Whether they hit their target last week, and if not, by how much." /></SortTh>
              <SortTh k="activity" sort={psort}>Activity<Hint title="Activity" text="A green dot means they have Cappture open right now (seen in the last five minutes). Underneath is when they last signed in. Hover for exact times. Never means they haven't signed in yet." /></SortTh>
              <th /></tr></thead>
            <tbody>
              {activeSorted.map((u) => {
                const lw = weeks[u.id]
                return (
                  <tr key={u.id}>
                    <td><div className="row" style={{ gap: 10 }}><span className="avatar sm" style={{ background: av(u.full_name || u.email) }}>{initials(u.full_name || u.email)}</span><div className="col" style={{ gap: 0 }}><b>{u.full_name || '—'}</b><span className="tiny muted">{u.email}</span></div></div></td>
                    <td><select className="select" style={{ height: 32, width: 150 }} value={u.team_id || ''} onChange={(e) => patch(u, { team_id: e.target.value || null })}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
                    <td><select className="select" style={{ height: 32, width: 120 }} value={u.role} onChange={(e) => patch(u, { role: e.target.value })} disabled={u.id === me.id}><option value="member">Member</option><option value="manager">Manager</option><option value="admin">Admin</option></select></td>
                    <td><select className="select" style={{ height: 32, width: 150 }} value={u.manager_id || ''} onChange={(e) => patch(u, { manager_id: e.target.value || null })}><option value="">Nobody</option>{people.filter((m) => m.active && m.id !== u.id && m.role !== 'member').map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></td>
                    <td className="num"><input className="input" type="number" min="0" max="60" step="0.5" defaultValue={u.weekly_target} onBlur={(e) => Number(e.target.value) !== Number(u.weekly_target) && patch(u, { weekly_target: Number(e.target.value) })} style={{ width: 70, height: 32, textAlign: 'right' }} aria-label="Weekly target" /></td>
                    <td className="num" style={{ fontWeight: 600, color: lw === undefined ? 'var(--ok)' : lw.logged === 0 ? 'var(--bad)' : 'var(--warn)' }} title={lw ? `${fmtHours(lw.logged)} logged` : ''}>{lw === undefined ? 'On target' : lw.logged === 0 ? 'Nothing logged' : `${fmtHours(lw.short)} short`}</td>
                    <td>{(() => { const act = activity[u.id] || {}; const online = act.last_seen_at && (Date.now() - new Date(act.last_seen_at).getTime()) < 5 * 60000
                      return (
                        <div className="col" style={{ gap: 2 }} title={`Last signed in: ${act.last_sign_in_at ? fmtDateTime(act.last_sign_in_at) : 'never'}${act.last_seen_at ? `\nLast seen: ${fmtDateTime(act.last_seen_at)}` : ''}`}>
                          <span className="row small" style={{ gap: 6, fontWeight: 600, color: online ? 'var(--ok)' : 'var(--text-2)' }}><i className="presence" style={{ background: online ? '#1E9E5A' : '#C4C4CC', boxShadow: online ? '0 0 0 3px rgba(30,158,90,.18)' : 'none' }} />{online ? 'Online now' : act.last_seen_at ? `Seen ${timeAgo(act.last_seen_at)}` : 'Not seen yet'}</span>
                          <span className="tiny muted">{act.last_sign_in_at ? `Signed in ${timeAgo(act.last_sign_in_at)}` : 'Never signed in'}</span>
                        </div>
                      ) })()}</td>
                    <td className="num"><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button className="btn sm" onClick={() => resetPassword(u)} title="Issue a new temporary password">Reset password</button>
                      {u.id !== me.id && <button className="btn sm danger" onClick={() => { if (confirm(`Remove ${u.full_name || u.email} from Cappture? Their logged time stays in reports.`)) patch(u, { active: false }) }}>Remove</button>}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-b col" style={{ gap: 10 }}>
        <h2>Teams<Hint title="Teams" text="Just the list of teams people can belong to. The number is how many active people are in each." /></h2>
        <div className="row wrap" style={{ gap: 6 }}>{teams.map((t) => <span key={t.id} className="pill" style={{ cursor: 'default', display: 'inline-flex', alignItems: 'center' }}>{t.name} <span className="tiny muted" style={{ marginLeft: 6 }}>{people.filter((u) => u.active && u.team_id === t.id).length}</span></span>)}</div>
        <form onSubmit={addTeam} className="row" style={{ maxWidth: 380 }}><input className="input" placeholder="New team name" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} /><button className="btn" type="submit" style={{ height: 38 }}>Add team</button></form>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
function lastWeekStart() { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow - 7); return d.toISOString().slice(0, 10) }

/* ------------------------------------------------------------------ Settings */
function Settings() {
  const [s, setS] = useState(null)
  const [toast, flash] = useToast()
  useEffect(() => { supabase.from('settings').select('key,value').then(({ data }) => { const m = {}; (data || []).forEach((r) => { m[r.key] = r.value }); setS(m) }) }, [])
  if (!s) return <div className="center">Loading…</div>

  async function save(key, value) {
    const { error } = await supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
    if (error) flash(error.message); else { setS((x) => ({ ...x, [key]: value })); flash('Saved') }
  }
  const domains = Array.isArray(s.allowed_email_domains) ? s.allowed_email_domains.join(', ') : ''
  const chunks = Array.isArray(s.duration_chunks) ? s.duration_chunks : []

  return (
    <>
      <section className="panel panel-b col" style={{ gap: 14 }}>
        <h2>Working week<Hint title="Working week" text="Company-wide defaults. The weekly target is what the ring on My week fills towards and what people get chased against. Hours in a day sets when a day column turns green and what a full day pill means. Day starts and ends set the clock range each column shows by default (it stretches automatically if someone works outside it). Allowed domains are email domains that can sign in without an invite." /></h2>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <label className="field">Default hours per week<input className="input" type="number" step="0.5" defaultValue={s.weekly_target_hours} onBlur={(e) => save('weekly_target_hours', Number(e.target.value))} /></label>
          <label className="field">Hours in a working day<input className="input" type="number" step="0.25" defaultValue={s.day_hours} onBlur={(e) => save('day_hours', Number(e.target.value))} /></label>
          <label className="field">Day starts<input className="input" type="time" step="900" defaultValue={s.day_start || '09:00'} onBlur={(e) => save('day_start', e.target.value)} /></label>
          <label className="field">Day ends<input className="input" type="time" step="900" defaultValue={s.day_end || '17:30'} onBlur={(e) => save('day_end', e.target.value)} /></label>
          <label className="field">Allowed sign-in domains<input className="input" defaultValue={domains} placeholder="cappfinity.com" onBlur={(e) => save('allowed_email_domains', e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))} /></label>
        </div>
        <span className="small muted">Individual targets, for part-timers say, are set per person under People and override this default.</span>
      </section>

      <section className="panel panel-b col" style={{ gap: 10 }}>
        <h2>Time chunks<Hint title="Time chunks" text="The quick-pick buttons on each entry. Most time fits one of these. Anything that doesn't can be typed in, so you don't need a chunk for every possibility." /></h2>
        <span className="small muted">Label and hours for each duration pill, in the order they appear.</span>
        <ChunkEditor chunks={chunks} onSave={(c) => save('duration_chunks', c)} />
      </section>

      <section className="panel panel-b col" style={{ gap: 14 }}>
        <h2>Reminders<Hint title="Reminders" text="The Friday nudge goes to anyone who's still short on Friday afternoon. The Monday chase goes to anyone who finished last week short. Turn on approval if you want managers to sign off each week before it counts." /></h2>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <label className="field">Friday nudge<select className="select" defaultValue={s.friday_nudge_time} onChange={(e) => save('friday_nudge_time', e.target.value)}><option>14:00</option><option>15:00</option><option>16:00</option><option value="off">Off</option></select></label>
          <label className="field">Monday chase for last week<select className="select" defaultValue={s.monday_chase_time} onChange={(e) => save('monday_chase_time', e.target.value)}><option>08:00</option><option>09:00</option><option>12:00</option><option value="off">Off</option></select></label>
        </div>
        <label className="checkbox"><input type="checkbox" checked={!!s.cc_manager_on_chase} onChange={(e) => save('cc_manager_on_chase', e.target.checked)} /> Copy the person's manager on the Monday chase</label>
        <label className="checkbox"><input type="checkbox" checked={!!s.require_approval} onChange={(e) => save('require_approval', e.target.checked)} /> Require weekly submission and manager approval <span className="small muted">(honour system while off)</span></label>
        <div className="note info">Email delivery for these reminders is coming in the next phase, alongside the Outlook calendar sync. The settings are saved now so nothing needs redoing later.</div>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

function ChunkEditor({ chunks, onSave }) {
  const [rows, setRows] = useState(chunks)
  const set = (i, f) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...f } : r)))
  return (
    <div className="col" style={{ gap: 8 }}>
      {rows.map((r, i) => (
        <div className="row" key={i}><input className="input" style={{ width: 120, height: 34 }} value={r.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Label" /><input className="input" type="number" step="0.25" style={{ width: 90, height: 34 }} value={r.hours} onChange={(e) => set(i, { hours: Number(e.target.value) })} aria-label="Hours" /><span className="small muted">h</span><button className="icon-btn" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><X /></button></div>
      ))}
      <div className="row"><button className="btn sm" onClick={() => setRows((rs) => [...rs, { label: '', hours: 1 }])}>Add chunk</button><button className="btn sm primary" onClick={() => onSave(rows.filter((r) => r.label && r.hours > 0))}>Save chunks</button></div>
    </div>
  )
}
