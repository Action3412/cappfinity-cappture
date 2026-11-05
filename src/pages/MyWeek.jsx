import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { supabase } from '../lib/supabase.js'
import { weekStart, weekDays, addDays, today, dayName, shortDate, weekLabel, fmtHours, parseDuration } from '../lib/time.js'
import { fetchProjects, fetchWorkTypes, fetchMyAllocations, fetchMyProjectTotals, fetchWeekEntries, fetchPendingSuggestions, insertEntry, updateEntry, deleteEntry } from '../lib/data.js'
import Ring from '../components/Ring.jsx'
import { ChevronL, ChevronR, Repeat, Search, Plus, Pencil, Calendar, Check, Info } from '../components/Icons.jsx'
import Hint from '../components/Hint.jsx'
import WeekPicker from '../components/WeekPicker.jsx'
import { DayColumn, EntryPopover } from '../components/DayBoard.jsx'

const DEFAULT_CHUNKS = [
  { label: '30m', hours: 0.5 }, { label: '1h', hours: 1 }, { label: '2h', hours: 2 },
  { label: '½ day', hours: 3.75 }, { label: 'Full day', hours: 7.5 },
]

export default function MyWeek() {
  const { user, weeklyTarget, settings } = useAuth()
  const params = useParams()
  const nav = useNavigate()
  const ws = params.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(params.weekStart) ? weekStart(params.weekStart) : weekStart(today())
  const days = useMemo(() => weekDays(ws), [ws])
  const chunks = Array.isArray(settings.duration_chunks) && settings.duration_chunks.length ? settings.duration_chunks : DEFAULT_CHUNKS
  const dayHours = Number(settings.day_hours ?? 7.5)

  const [projects, setProjects] = useState([])
  const [workTypes, setWorkTypes] = useState([])
  const [allocs, setAllocs] = useState({})
  const [totals, setTotals] = useState({})
  const [entries, setEntries] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [query, setQuery] = useState('')
  const [quick, setQuick] = useState('all') // all | mine | recent | client | internal
  const [clientFilter, setClientFilter] = useState('all')
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem('cappture.collapsed') || '{}') } catch { return {} } })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editing, setEditing] = useState(null) // { id, anchor }
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2200) }

  const load = useCallback(async () => {
    try {
      setErr('')
      const [p, w, a, t, e, s] = await Promise.all([
        fetchProjects(), fetchWorkTypes(), fetchMyAllocations(user.id), fetchMyProjectTotals(user.id),
        fetchWeekEntries(user.id, days[0], days[4]), fetchPendingSuggestions(user.id),
      ])
      setProjects(p); setWorkTypes(w); setTotals(t); setSuggestions(s)
      const am = {}; a.forEach((r) => { am[r.project_id] = Number(r.hours) }); setAllocs(am)
      setEntries(e.map((x) => ({ ...x, hours: Number(x.hours) })))
    } catch (ex) { setErr(ex.message || String(ex)) }
    finally { setLoading(false) }
  }, [user.id, days])

  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => {
    const k = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return
      if (e.key === 'ArrowLeft') nav(`/week/${addDays(ws, -7)}`)
      if (e.key === 'ArrowRight') nav(`/week/${addDays(ws, 7)}`)
    }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [ws, nav])
  function toggleClient(id) {
    setCollapsed((c) => { const n = { ...c, [id]: !c[id] }; try { localStorage.setItem('cappture.collapsed', JSON.stringify(n)) } catch {} return n })
  }

  const projById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects])
  const wtById = useMemo(() => Object.fromEntries(workTypes.map((w) => [w.id, w])), [workTypes])

  // ---- project list: allocated first, then used, then the rest; internal last
  const clientOptions = useMemo(() => {
    const m = new Map(); projects.forEach((p) => { if (p.client && !p.client.is_internal) m.set(p.client.id, p.client.name) })
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [projects])
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    const score = (p) => (allocs[p.id] ? 0 : totals[p.id] ? 1 : 2)
    return projects
      .filter((p) => !q || `${p.name} ${p.code} ${p.client?.name}`.toLowerCase().includes(q))
      .filter((p) => quick === 'all' || (quick === 'mine' && allocs[p.id]) || (quick === 'recent' && totals[p.id]) || (quick === 'client' && !p.client?.is_internal) || (quick === 'internal' && p.client?.is_internal))
      .filter((p) => clientFilter === 'all' || p.client?.id === clientFilter)
      .sort((a, b) => (a.client?.is_internal - b.client?.is_internal) || (score(a) - score(b)) || a.name.localeCompare(b.name))
  }, [projects, query, allocs, totals, quick, clientFilter])
  // Group by client; internal last. Groups fold away (remembered per browser).
  const clientGroups = useMemo(() => {
    const m = new Map()
    visibleProjects.forEach((p) => {
      const key = p.client?.id || 'none'
      if (!m.has(key)) m.set(key, { id: key, label: p.client?.name || 'Other', internal: !!p.client?.is_internal, items: [] })
      m.get(key).items.push(p)
    })
    return [...m.values()].sort((a, b) => (a.internal - b.internal) || a.label.localeCompare(b.label))
  }, [visibleProjects])
  const filtering = quick !== 'all' || clientFilter !== 'all' || query.trim()

  // ---- entries
  const weekTotal = entries.reduce((a, e) => a + (e.hours || 0), 0)
  const billable = entries.reduce((a, e) => a + ((projById[e.project_id]?.billable) ? e.hours || 0 : 0), 0)
  const remaining = Math.max(0, weeklyTarget - weekTotal)

  // Dropping a project creates a one-hour block straight away, then opens the editor on it.
  async function addEntry(projectId, date, anchorAfter = true) {
    if (!projById[projectId]) return
    setDragging(null); setOver(null)
    try {
      const row = await insertEntry({ profile_id: user.id, project_id: projectId, work_type_id: null, entry_date: date, hours: 1, note: null, source: 'manual' })
      const e = { ...row, hours: Number(row.hours) }
      setEntries((es) => [...es, e])
      refreshTotals()
      if (anchorAfter) setTimeout(() => {
        const el = document.querySelector(`[data-day="${date}"] .block:last-of-type`)
        setEditing({ id: e.id, anchor: el })
      }, 30)
    } catch (ex) { flash(ex.message) }
  }
  const patch = (id, f) => setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...f } : e)))

  // Optimistic update, then persist. Roll back if the save fails.
  async function commit(e, fields) {
    const before = { ...e }
    patch(e.id, fields)
    try { await updateEntry(e.id, fields); refreshTotals() }
    catch (ex) { patch(e.id, before); flash(ex.message) }
  }
  async function remove(e) {
    setEditing(null)
    setEntries((es) => es.filter((x) => x.id !== e.id))
    try { await deleteEntry(e.id); refreshTotals() } catch (ex) { flash(ex.message); load() }
  }
  async function refreshTotals() { try { setTotals(await fetchMyProjectTotals(user.id)) } catch {} }

  async function repeatLastWeek() {
    const { data, error } = await supabase.rpc('repeat_last_week', { p_week_start: ws })
    if (error) { flash(error.message); return }
    flash(data ? `Copied ${data} ${data === 1 ? 'entry' : 'entries'} from last week` : 'Nothing new to copy from last week')
    load()
  }

  async function acceptSuggestion(s) {
    try {
      await insertEntry({ profile_id: user.id, project_id: s.matched_project_id, work_type_id: workTypes.find((w) => /meeting/i.test(w.name))?.id ?? null, entry_date: s.starts_at.slice(0, 10), hours: Number(s.hours), note: s.title, source: 'calendar' })
      await supabase.from('calendar_suggestions').update({ status: 'accepted' }).eq('id', s.id)
      load()
    } catch (ex) { flash(ex.message) }
  }
  async function dismissSuggestion(s) {
    await supabase.from('calendar_suggestions').update({ status: 'dismissed' }).eq('id', s.id)
    setSuggestions((x) => x.filter((y) => y.id !== s.id))
  }

  // ---- drag & drop
  const onDragStart = (p) => (ev) => { ev.dataTransfer.setData('text/plain', p.id); ev.dataTransfer.effectAllowed = 'copy'; setDragging(p.id) }
  const onDropProject = (ev, date) => { const id = ev.dataTransfer.getData('text/plain') || dragging; if (id) addEntry(id, date) }
  const quickAddDate = days.includes(today()) ? today() : days[0]

  const t = today()
  const isCurrentWeek = ws === weekStart(t)
  const editingEntry = editing ? entries.find((x) => x.id === editing.id) : null

  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <h1>My week</h1>
          <Hint title="How this works" text="Drag a project from the left onto a day and it lands as a one-hour block. Pull the block's bottom edge to make it longer or shorter, drag it to another day if you got the day wrong, and click it to set the work type or add a note. Keep going until each day is full and the ring on the right completes." />
          <div className="row" style={{ gap: 2, position: 'relative' }}>
            <button className="btn sm ghost" aria-label="Previous week" title="Previous week (←)" onClick={() => nav(`/week/${addDays(ws, -7)}`)}><ChevronL /></button>
            <button type="button" className="week-nav-btn" onClick={() => setPickerOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={pickerOpen} title="Pick a week">
              <Calendar width="15" height="15" style={{ color: 'var(--muted)' }} />{weekLabel(ws)}
            </button>
            <button className="btn sm ghost" aria-label="Next week" title="Next week (→)" onClick={() => nav(`/week/${addDays(ws, 7)}`)}><ChevronR /></button>
            {!isCurrentWeek && <button className="btn sm" onClick={() => nav('/')}>This week</button>}
            {pickerOpen && <WeekPicker uid={user.id} weekStart={ws} dayHours={dayHours} onPick={(w) => nav(w === weekStart(today()) ? '/' : `/week/${w}`)} onClose={() => setPickerOpen(false)} />}
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {!loading && remaining > 0 && <span className="banner warn"><Info /> {fmtHours(remaining)} still to log this week</span>}
          {!loading && remaining === 0 && <span className="banner ok"><Check /> Week complete, nice one</span>}
          <span className="row" style={{ gap: 6 }}><button className="btn" onClick={repeatLastWeek}><Repeat /> Repeat last week</button><Hint align="right" title="Repeat last week" text="Copies last week's entries into this week, same days, same hours, same work types, so you only have to tweak what changed. It skips anything that would be a duplicate and ignores archived projects." /></span>
        </div>
      </div>

      {err && <div className="note" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="week-layout">
        {/* Projects */}
        <aside className="week-side col" style={{ gap: 12 }}>
          <div className="row between"><span className="row" style={{ gap: 6 }}><h2>My projects</h2><Hint title="My projects" text="Every live project you can log time to, grouped by client. Mine shows only projects you've been allocated hours on, Recent shows ones you've logged against before, and the dropdown narrows to one client. Click a client name to fold its projects away. Can't see a project? Ask an admin to add it." /></span><span className="tiny muted">Drag onto a day</span></div>
          <label className="search"><Search style={{ color: 'var(--muted)' }} /><span className="sr">Search projects</span>
            <input type="search" placeholder="Search client or project…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="col" style={{ gap: 8 }}>
            <div className="seg" role="tablist" aria-label="Filter projects">
              {[['all', 'All'], ['mine', 'Mine'], ['recent', 'Recent'], ['client', 'Client'], ['internal', 'Internal']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={quick === k} className={quick === k ? 'on' : ''} onClick={() => setQuick(k)}>{l}</button>
              ))}
            </div>
            {clientOptions.length > 1 && (
              <select className="select" style={{ height: 34, fontSize: 13 }} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Filter by client">
                <option value="all">All clients</option>
                {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
          </div>
          {!loading && filtering && visibleProjects.length === 0 && <div className="note info">Nothing matches. <button className="btn sm ghost" style={{ height: 24 }} onClick={() => { setQuery(''); setQuick('all'); setClientFilter('all') }}>Clear filters</button></div>}
          {clientGroups.map((g) => (
            <div className="col" style={{ gap: 6 }} key={g.id}>
              <button type="button" className="client-head" onClick={() => toggleClient(g.id)} aria-expanded={!collapsed[g.id]}>
                <span className="label">{g.label}</span>
                <span className="tiny muted row" style={{ gap: 4 }}>{g.items.length}<ChevronR width="11" height="11" style={{ transform: collapsed[g.id] ? 'none' : 'rotate(90deg)', transition: 'transform .15s' }} /></span>
              </button>
              {!collapsed[g.id] && g.items.map((p) => {
                const alloc = allocs[p.id], used = totals[p.id] || 0
                const pct = alloc ? Math.min(100, Math.round((used / alloc) * 100)) : 0
                const overB = alloc && used > alloc
                return (
                  <div key={p.id} className="proj" draggable onDragStart={onDragStart(p)} onDragEnd={() => { setDragging(null); setOver(null) }}
                    onClick={() => addEntry(p.id, quickAddDate)} title={`Drag onto a day, or click to add to ${dayName(quickAddDate)}`}>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="swatch" style={{ background: p.colour }} />
                      <div className="col" style={{ gap: 0, minWidth: 0, flex: 1 }}>
                        <span className="name">{p.name}</span>
                        <span className="tiny muted">{p.client?.name} · {p.code}</span>
                      </div>
                    </div>
                    {alloc > 0 && (
                      <div className="col" style={{ gap: 4 }}>
                        <div className="bar" style={{ height: 4 }}><div style={{ width: `${pct}%`, background: overB ? 'var(--bad)' : pct >= 90 ? 'var(--gold)' : p.colour }} /></div>
                        <div className="row between tiny muted"><span className="row" style={{ gap: 4 }}>{fmtHours(used)} of {alloc}h<Hint size={12} title="Your allocation" text="The hours you've been given on this project and how many you've used so far, across all weeks. It turns gold at 90% and red if you go over. Going over doesn't stop you logging, it just flags it to whoever's running the project." /></span><span>{overB ? `${fmtHours(used - alloc)} over` : `${fmtHours(alloc - used)} left`}</span></div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {!loading && projects.length === 0 && <div className="note info">No projects yet. An admin adds them under Admin, Client projects.</div>}
        </aside>

        {/* Week board */}
        <main className="week-main">
          <div className="days">
            {days.map((d) => (
              <DayColumn key={d} date={d} entries={entries.filter((e) => e.entry_date === d)} dayHours={dayHours} projById={projById} wtById={wtById}
                isToday={d === t} isFirst={d === days[0]} over={over === d} editingId={editing?.id}
                onDropProject={onDropProject}
                onOpen={(e, el) => setEditing({ id: e.id, anchor: el })}
                onResize={(e, h) => commit(e, { hours: h })}
                onMove={(e, date) => commit(e, { entry_date: date })} />
            ))}
          </div>
          {editingEntry && (
            <EntryPopover e={editingEntry} anchor={editing.anchor} project={projById[editingEntry.project_id]} workTypes={workTypes} chunks={chunks}
              onChange={(f) => commit(editingEntry, f)} onRemove={remove} onClose={() => setEditing(null)} />
          )}
        </main>

        {/* Right rail */}
        <aside className="week-right col" style={{ gap: 14 }}>
          <div className="dark ring-card">
            <Ring value={weekTotal} target={weeklyTarget}>
              <b>{fmtHours(weekTotal).replace(/h$/, '')}</b>
              <span className="small" style={{ opacity: .7 }}>of {weeklyTarget} hrs</span>
            </Ring>
            <div style={{ fontWeight: 600, textAlign: 'center' }} className="row">
              <Hint align="center" title="Your week" text="Everything you've logged this week against your target (normally 37.5 hours). Billable is time on client projects. Internal is pitches, admin, learning, leave and so on. Both count towards the target, so a week off still adds up to 37.5." />
              {remaining > 0 ? `${fmtHours(remaining)} to go this week` : weekTotal > weeklyTarget ? `${fmtHours(weekTotal - weeklyTarget)} over, all logged` : `All ${weeklyTarget} hours logged`}
            </div>
            <div className="stat-grid">
              <div className="col" style={{ gap: 2 }}><span className="tiny" style={{ opacity: .7 }}>Billable</span><b style={{ color: 'var(--gold)' }}>{fmtHours(billable)}</b></div>
              <div className="col" style={{ gap: 2 }}><span className="tiny" style={{ opacity: .7 }}>Internal</span><b>{fmtHours(weekTotal - billable)}</b></div>
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="panel panel-b col" style={{ gap: 10 }}>
              <div className="row between"><div className="row"><Calendar style={{ color: 'var(--blue)' }} /><h2>From your Outlook</h2><Hint title="From your Outlook" text="Meetings in your calendar that look like they belong to a project, matched on the project code in the subject or who was invited. Nothing is logged until you say so. Dismiss anything that's wrong." /></div><span className="small muted">{suggestions.length} to review</span></div>
              <p className="small muted" style={{ margin: 0 }}>Meetings we've matched to a project. Log them with one click, or dismiss.</p>
              {suggestions.map((s) => {
                const p = projById[s.matched_project_id]
                return (
                  <div className="ghost" key={s.id}>
                    <div className="row between" style={{ alignItems: 'flex-start' }}>
                      <div className="col" style={{ gap: 0, minWidth: 0 }}><b className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</b><span className="tiny muted">{dayName(s.starts_at.slice(0, 10))} {shortDate(s.starts_at.slice(0, 10))}</span></div>
                      <b className="small">{fmtHours(s.hours)}</b>
                    </div>
                    {p && <div className="row tiny" style={{ color: 'var(--text-2)' }}><span className="swatch" style={{ background: p.colour, width: 8, height: 8 }} />{p.client?.name} · {p.name}</div>}
                    <div className="row"><button className="btn sm blue grow" style={{ justifyContent: 'center' }} onClick={() => acceptSuggestion(s)} disabled={!p}>Log it</button><button className="btn sm" onClick={() => dismissSuggestion(s)}>Dismiss</button></div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="panel panel-b col" style={{ gap: 8 }}>
            <h3>Shortcuts</h3>
            <ul className="small" style={{ margin: 0, padding: 0, listStyle: 'none', color: 'var(--text-2)' }}>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', paddingBottom: 6 }}><span>Drag a project in</span><span className="muted">1h block on that day</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Click a project</span><span className="muted">adds to {dayName(quickAddDate)}</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Pull a block's edge</span><span className="muted">change the time</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Drag a block</span><span className="muted">move to another day</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Click a block</span><span className="muted">work type and note</span></li>
              <li className="row between" style={{ paddingTop: 6 }}><span>← →</span><span className="muted">previous / next week</span></li>
            </ul>
          </div>
        </aside>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
