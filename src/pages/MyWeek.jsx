import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { supabase } from '../lib/supabase.js'
import { weekStart, weekDays, addDays, today, dayName, shortDate, weekLabel, fmtHours, timeToHours, hoursToTime } from '../lib/time.js'
import { fetchProjects, fetchWorkTypes, fetchMyAllocations, fetchMyProjectTotals, fetchWeekEntries, fetchPendingSuggestions, insertEntry, updateEntry, deleteEntry } from '../lib/data.js'
import Ring from '../components/Ring.jsx'
import { ChevronL, ChevronR, Repeat, Search, Plus, Pencil, Calendar, Check, Info } from '../components/Icons.jsx'
import Hint from '../components/Hint.jsx'
import WeekPicker from '../components/WeekPicker.jsx'
import { DayColumn, EntryPopover, TimeGutter, dayRange, startOf, boardTargetAt, showGhost } from '../components/DayBoard.jsx'

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
  const dayStart = timeToHours(settings.day_start) ?? 9
  const dayEnd = timeToHours(settings.day_end) ?? 17.5

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
      const am = {}; a.forEach((r) => { am[r.project_id] = r.hours === null ? true : Number(r.hours) }); setAllocs(am)
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

  // First gap of at least `len` hours on a day, from `fromT` onwards; else straight after the last block.
  function nextFree(date, fromT, len = 1, ignoreId = null) {
    const list = entries.filter((x) => x.entry_date === date && x.id !== ignoreId).map((x) => [startOf(x, dayStart), startOf(x, dayStart) + x.hours]).sort((a, b) => a[0] - b[0])
    let t = fromT
    for (const [s0, e0] of list) { if (e0 <= t) continue; if (s0 >= t + len) break; t = e0 }
    return Math.round(t * 4) / 4
  }
  // Put a new block exactly where it was dropped. If that's inside another block, go straight after it.
  // If the gap is shorter than `len`, shrink to fit (down to 15 minutes).
  function placeAt(date, at, len = 1) {
    const list = entries.filter((x) => x.entry_date === date).map((x) => [startOf(x, dayStart), startOf(x, dayStart) + x.hours]).sort((a, b) => a[0] - b[0])
    const inside = list.find(([s0, e0]) => at >= s0 && at < e0)
    let start = inside ? inside[1] : at
    const next = list.find(([s0]) => s0 >= start + 0.01)
    let hours = len
    if (next && next[0] < start + len) hours = Math.max(0.25, Math.round((next[0] - start) * 4) / 4)
    if (next && next[0] - start < 0.25) { start = nextFree(date, start, len); hours = len }
    return { start, hours }
  }
  // Dropping a project creates a one-hour block at that time (or the next gap), then opens the editor on it.
  async function addEntry(projectId, date, at = null, anchorAfter = true) {
    if (!projById[projectId]) return
    setDragging(null); setOver(null)
    const { start: startT, hours: len } = at === null ? { start: nextFree(date, dayStart, 1), hours: 1 } : placeAt(date, at, 1)
    try {
      const row = await insertEntry({ profile_id: user.id, project_id: projectId, work_type_id: null, entry_date: date, hours: len, note: null, source: 'manual', start_time: hoursToTime(startT) })
      const e = { ...row, hours: Number(row.hours) }
      setEntries((es) => [...es, e])
      refreshTotals()
      if (anchorAfter) setTimeout(() => {
        const el = document.querySelector(`[data-day="${date}"] [data-entry="${e.id}"]`) || document.querySelector(`[data-day="${date}"] .block:last-of-type`)
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
  // Move or copy a block to a day at a clock time.
  async function moveEntry(e, date, startT, copy = false) {
    if (copy) {
      const at = startT ?? nextFree(date, date === e.entry_date ? startOf(e, dayStart) + e.hours : startOf(e, dayStart), e.hours)
      try {
        const row = await insertEntry({ profile_id: user.id, project_id: e.project_id, work_type_id: e.work_type_id, entry_date: date, hours: e.hours, note: e.note, source: 'copied', start_time: hoursToTime(at) })
        setEntries((es) => [...es, { ...row, hours: Number(row.hours) }])
        refreshTotals(); flash(`Copied to ${dayName(date)} at ${hoursToTime(at)}`)
      } catch (ex) { flash(ex.message) }
      return
    }
    await commit(e, { entry_date: date, start_time: hoursToTime(startT) })
  }
  // Cut a block in two, back to back. The second half gets no work type yet and opens for editing.
  async function splitEntry(e) {
    const half = Math.max(0.25, Math.round((e.hours / 2) * 4) / 4)
    const rest = Math.round((e.hours - half) * 4) / 4
    if (rest < 0.25) { flash('Too short to split'); return }
    const start = startOf(e, dayStart)
    try {
      await commit(e, { hours: half })
      const row = await insertEntry({ profile_id: user.id, project_id: e.project_id, work_type_id: null, entry_date: e.entry_date, hours: rest, note: null, source: 'manual', start_time: hoursToTime(start + half) })
      const n = { ...row, hours: Number(row.hours) }
      setEntries((es) => [...es, n])
      setTimeout(() => setEditing({ id: n.id, anchor: document.querySelector(`[data-entry="${n.id}"]`) }), 30)
    } catch (ex) { flash(ex.message) }
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
      await insertEntry({ profile_id: user.id, project_id: s.matched_project_id, work_type_id: workTypes.find((w) => /meeting/i.test(w.name))?.id ?? null, entry_date: s.starts_at.slice(0, 10), hours: Number(s.hours), note: s.title, source: 'calendar', start_time: new Date(s.starts_at).toTimeString().slice(0, 5) })
      await supabase.from('calendar_suggestions').update({ status: 'accepted' }).eq('id', s.id)
      load()
    } catch (ex) { flash(ex.message) }
  }
  async function dismissSuggestion(s) {
    await supabase.from('calendar_suggestions').update({ status: 'dismissed' }).eq('id', s.id)
    setSuggestions((x) => x.filter((y) => y.id !== s.id))
  }

  // ---- dragging a project from the list onto the board (pointer based, with a live ghost at the time under the cursor)
  const projDrag = useRef(null)
  function projDown(p) {
    return (ev) => {
      if (ev.button !== 0) return
      const g = { p, x0: ev.clientX, y0: ev.clientY, moved: false, target: null, chip: null }
      projDrag.current = g
      const move = (e2) => {
        if (!g.moved && Math.hypot(e2.clientX - g.x0, e2.clientY - g.y0) < 6) return
        if (!g.moved) {
          g.moved = true; document.body.classList.add('dragging')
          g.chip = document.createElement('div'); g.chip.className = 'drag-chip'
          g.chip.innerHTML = `<span class="swatch" style="background:${p.colour}"></span><b>${p.name}</b><span class="tiny muted">1h</span>`
          document.body.appendChild(g.chip)
        }
        g.chip.style.left = `${e2.clientX + 14}px`; g.chip.style.top = `${e2.clientY + 10}px`
        g.target = boardTargetAt(e2.clientX, e2.clientY)
        showGhost(g.target, 1)
      }
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
        document.body.classList.remove('dragging'); showGhost(null); g.chip?.remove(); projDrag.current = null
        if (!g.moved) { addEntry(p.id, quickAddDate, null); return }
        if (g.target) addEntry(p.id, g.target.date, g.target.start)
      }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    }
  }
  const quickAddDate = days.includes(today()) ? today() : days[0]

  const t = today()
  const isCurrentWeek = ws === weekStart(t)
  const editingEntry = editing ? entries.find((x) => x.id === editing.id) : null
  const weekRange = dayRange(entries, dayStart, dayEnd)

  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <h1>My week</h1>
          <Hint title="How this works" text="Each column is your working day on a clock. Drag a project in at the time you started it and it lands as a one-hour block. Pull either end to set how long, drag it up, down or across to another day, and click it to set the work type or add a note. Gaps are fine, that's lunch. Keep going until the ring on the right completes." />
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
        <aside className="week-side panel side-panel">
          <div className="row between"><span className="row" style={{ gap: 6 }}><h2>My projects</h2><Hint title="My projects" text="Every live project you can log time to, grouped by client. Mine shows only projects you've been put on, Recent shows ones you've logged against before, and the dropdown narrows to one client. Click a client name to fold its projects away. Can't see a project? Ask an admin to add it." /></span><span className="tiny muted">Drag onto a day</span></div>
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
          <div className="proj-list">
          {!loading && filtering && visibleProjects.length === 0 && <div className="note info">Nothing matches. <button className="btn sm ghost" style={{ height: 24 }} onClick={() => { setQuery(''); setQuick('all'); setClientFilter('all') }}>Clear filters</button></div>}
          {clientGroups.map((g) => (
            <div className="col" style={{ gap: 6 }} key={g.id}>
              <button type="button" className="client-head" onClick={() => toggleClient(g.id)} aria-expanded={!collapsed[g.id]}>
                <span className="label">{g.label}</span>
                <span className="tiny muted row" style={{ gap: 4 }}>{g.items.length}<ChevronR width="11" height="11" style={{ transform: collapsed[g.id] ? 'none' : 'rotate(90deg)', transition: 'transform .15s' }} /></span>
              </button>
              {!collapsed[g.id] && g.items.map((p) => {
                const onProject = !!allocs[p.id], alloc = typeof allocs[p.id] === 'number' ? allocs[p.id] : 0, used = totals[p.id] || 0
                const pct = alloc ? Math.min(100, Math.round((used / alloc) * 100)) : 0
                const overB = alloc && used > alloc
                return (
                  <div key={p.id} className="proj" onPointerDown={projDown(p)} title={`Drag onto a day at the time you started, or click to add to ${dayName(quickAddDate)}`}>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="swatch" style={{ background: p.colour }} />
                      <div className="col" style={{ gap: 0, minWidth: 0, flex: 1 }}>
                        <span className="name">{p.name}</span>
                        <span className="tiny muted">{p.client?.name} · {p.code}</span>
                      </div>
                      {onProject && !alloc && <span className="tag" style={{ fontSize: 10, padding: '2px 7px' }} title="You're on this project">Mine</span>}
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
          </div>
        </aside>

        {/* Week board */}
        <main className="week-main">
          <div className="board">
            <TimeGutter from={weekRange[0]} to={weekRange[1]} dayStart={dayStart} dayEnd={dayEnd} />
            {days.map((d) => (
              <DayColumn key={d} date={d} entries={entries.filter((e) => e.entry_date === d)} dayHours={dayHours} dayStart={dayStart} dayEnd={dayEnd} range={weekRange} projById={projById} wtById={wtById}
                isToday={d === t} isFirst={d === days[0]} editingId={editing?.id}
                onOpen={(e, el) => setEditing((ed) => (ed?.id === e.id ? null : { id: e.id, anchor: el }))}
                onResize={(e, h, startT) => commit(e, { hours: h, start_time: hoursToTime(startT) })}
                onMove={(e, date, startT, copy) => moveEntry(e, date, startT, copy)} />
            ))}
          </div>
          {editingEntry && <div className="pop-backdrop" onMouseDown={() => setEditing(null)} aria-hidden="true" />}
          {editingEntry && (
            <EntryPopover e={editingEntry} anchor={editing.anchor} project={projById[editingEntry.project_id]} workTypes={workTypes} chunks={chunks} days={days}
              onChange={(f) => commit(editingEntry, f)} onRemove={remove} onCopy={(e, date) => moveEntry(e, date, date === e.entry_date ? null : startOf(e, dayStart), true)} onSplit={splitEntry} onClose={() => setEditing(null)} />
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
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', paddingBottom: 6 }}><span>Drag a project in</span><span className="muted">1h block at that time</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Click a project</span><span className="muted">adds to {dayName(quickAddDate)}</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Pull either end</span><span className="muted">start or finish time</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Drag a block</span><span className="muted">move in the day or across</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Alt + drag a block</span><span className="muted">copy it</span></li>
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
