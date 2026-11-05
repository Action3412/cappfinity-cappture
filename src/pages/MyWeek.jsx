import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { supabase } from '../lib/supabase.js'
import { weekStart, weekDays, addDays, today, dayName, shortDate, weekLabel, fmtHours, parseDuration } from '../lib/time.js'
import { fetchProjects, fetchWorkTypes, fetchMyAllocations, fetchMyProjectTotals, fetchWeekEntries, fetchPendingSuggestions, insertEntry, updateEntry, deleteEntry } from '../lib/data.js'
import Ring from '../components/Ring.jsx'
import { ChevronL, ChevronR, Repeat, Search, Plus, Pencil, Calendar, Check, Info } from '../components/Icons.jsx'
import Hint from '../components/Hint.jsx'

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
      setEntries(e.map((x) => ({ ...x, hours: Number(x.hours), editing: false })))
    } catch (ex) { setErr(ex.message || String(ex)) }
    finally { setLoading(false) }
  }, [user.id, days])

  useEffect(() => { setLoading(true); load() }, [load])

  const projById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects])
  const wtById = useMemo(() => Object.fromEntries(workTypes.map((w) => [w.id, w])), [workTypes])

  // ---- project list: allocated first, then used, then the rest; internal last
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    const score = (p) => (allocs[p.id] ? 0 : totals[p.id] ? 1 : 2)
    return projects
      .filter((p) => !q || `${p.name} ${p.code} ${p.client?.name}`.toLowerCase().includes(q))
      .sort((a, b) => (a.client?.is_internal - b.client?.is_internal) || (score(a) - score(b)) || a.name.localeCompare(b.name))
  }, [projects, query, allocs, totals])
  const clientGroups = useMemo(() => {
    const client = visibleProjects.filter((p) => !p.client?.is_internal)
    const internal = visibleProjects.filter((p) => p.client?.is_internal)
    return [{ label: 'Client projects', items: client }, { label: 'Internal', items: internal }].filter((g) => g.items.length)
  }, [visibleProjects])

  // ---- entries
  const weekTotal = entries.reduce((a, e) => a + (e.hours || 0), 0)
  const billable = entries.reduce((a, e) => a + ((projById[e.project_id]?.billable) ? e.hours || 0 : 0), 0)
  const remaining = Math.max(0, weeklyTarget - weekTotal)
  const hasDraft = entries.some((e) => e.draft)

  function addEntry(projectId, date) {
    if (!projById[projectId]) return
    setEntries((es) => [...es.map((e) => ({ ...e, editing: false })), {
      id: 'tmp-' + Math.random().toString(36).slice(2), project_id: projectId, work_type_id: null,
      entry_date: date, hours: 0, note: '', source: 'manual', editing: true, draft: true,
    }])
    setDragging(null); setOver(null)
  }
  const patch = (id, f) => setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...f } : e)))

  async function save(e) {
    if (!e.hours || e.hours <= 0) { flash('Pick how long first'); return }
    try {
      if (e.draft) {
        const row = await insertEntry({ profile_id: user.id, project_id: e.project_id, work_type_id: e.work_type_id, entry_date: e.entry_date, hours: e.hours, note: e.note || null, source: e.source })
        setEntries((es) => es.map((x) => (x.id === e.id ? { ...row, hours: Number(row.hours), editing: false } : x)))
      } else {
        await updateEntry(e.id, { work_type_id: e.work_type_id, hours: e.hours, note: e.note || null })
        patch(e.id, { editing: false })
      }
      setTotals((t) => ({ ...t })) // nudge
      refreshTotals()
    } catch (ex) { flash(ex.message) }
  }
  async function remove(e) {
    setEntries((es) => es.filter((x) => x.id !== e.id))
    if (!e.draft) { try { await deleteEntry(e.id); refreshTotals() } catch (ex) { flash(ex.message); load() } }
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
  const onDrop = (date) => (ev) => { ev.preventDefault(); const id = ev.dataTransfer.getData('text/plain') || dragging; if (id) addEntry(id, date) }
  const quickAddDate = days.includes(today()) ? today() : days[0]

  const t = today()
  const isCurrentWeek = ws === weekStart(t)

  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 18, gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <h1>My week</h1>
          <Hint title="How this works" text="Drag a project from the left onto a day, or click it to add it to today. Pick how long, pick what kind of work, save. Do that until the ring on the right fills up and you're done for the week." />
          <div className="row" style={{ gap: 2 }}>
            <button className="btn sm ghost" aria-label="Previous week" onClick={() => nav(`/week/${addDays(ws, -7)}`)}><ChevronL /></button>
            <span style={{ fontWeight: 600, padding: '0 6px' }}>{weekLabel(ws)}</span>
            <button className="btn sm ghost" aria-label="Next week" onClick={() => nav(`/week/${addDays(ws, 7)}`)}><ChevronR /></button>
            {!isCurrentWeek && <button className="btn sm" onClick={() => nav('/')}>This week</button>}
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
          <div className="row between"><span className="row" style={{ gap: 6 }}><h2>My projects</h2><Hint title="My projects" text="Every live project you can log time to. Ones you've been allocated hours on come first, then ones you've used recently, then the rest. Internal work like pitches, admin and leave sits at the bottom. Can't see a project? Ask an admin to add it." /></span><span className="tiny muted">Drag onto a day</span></div>
          <label className="search"><Search style={{ color: 'var(--muted)' }} /><span className="sr">Search projects</span>
            <input type="search" placeholder="Search client or project…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {clientGroups.map((g) => (
            <div className="col" style={{ gap: 6 }} key={g.label}>
              <div className="label" style={{ padding: '6px 4px 0' }}>{g.label}</div>
              {g.items.map((p) => {
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
            {days.map((d) => {
              const list = entries.filter((e) => e.entry_date === d)
              const tot = list.reduce((a, e) => a + (e.hours || 0), 0)
              const pct = Math.min(100, Math.round((tot / dayHours) * 100))
              const state = tot >= dayHours ? 'done' : d > t ? (tot > 0 ? 'part' : 'future') : tot > 0 ? 'part' : 'short'
              const left = Math.max(0, dayHours - tot)
              const status = state === 'done' ? 'Done' : state === 'part' ? `${fmtHours(left)} to go` : state === 'short' ? 'Nothing logged' : ''
              return (
                <section key={d} className={`day st-${state} ${d === t ? 'today' : ''} ${over === d ? 'over' : ''}`}
                  onDragOver={(ev) => { ev.preventDefault(); if (over !== d) setOver(d) }} onDragLeave={() => over === d && setOver(null)} onDrop={onDrop(d)}>
                  <div className="day-progress" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
                  <div className="row between" style={{ padding: '2px 6px' }}>
                    <div className="row" style={{ gap: 6, alignItems: 'baseline' }}><b>{dayName(d)}</b><span className="small muted">{shortDate(d)}</span>{d === t && <span className="today-pip">Today</span>}</div>
                    <span className="small row day-total" style={{ gap: 4, fontWeight: 600 }}>{state === 'done' && <Check width="13" height="13" />}{fmtHours(tot)}{d === days[0] && <Hint size={12} align="right" title="Day total" text={`Hours logged on this day. The column turns green once you reach a full working day (${dayHours}h), gold while it's part done, and pink if a day has passed with nothing or not enough on it. Future days stay grey.`} />}</span>
                  </div>
                  {list.map((e) => (
                    <EntryCard key={e.id} e={e} project={projById[e.project_id]} workType={wtById[e.work_type_id]} workTypes={workTypes} chunks={chunks}
                      onEdit={() => setEntries((es) => es.map((x) => ({ ...x, editing: x.id === e.id })))}
                      onChange={(f) => patch(e.id, f)} onSave={() => save(e)} onRemove={() => remove(e)} />
                  ))}
                  {status && list.length > 0 && <div className={`day-status`}>{status}</div>}
                  {list.length === 0 && <div className="drop-hint"><Plus /> {state === 'short' ? 'Nothing logged yet' : 'Drop a project here'}</div>}
                </section>
              )
            })}
          </div>
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
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', paddingBottom: 6 }}><span>Click a project</span><span className="muted">adds to {dayName(quickAddDate)}</span></li>
              <li className="row between" style={{ borderBottom: '1px dotted var(--line)', padding: '6px 0' }}><span>Drag a project</span><span className="muted">adds to that day</span></li>
              <li className="row between" style={{ paddingTop: 6 }}><span>Repeat last week</span><span className="muted">copies, then edit</span></li>
            </ul>
          </div>
        </aside>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      {hasDraft && <span className="sr">You have an unsaved entry</span>}
    </div>
  )
}

function DurationInput({ hours, isChunk, onChange }) {
  const [text, setText] = useState(isChunk || !hours ? '' : fmtHours(hours))
  const [bad, setBad] = useState(false)
  useEffect(() => { if (isChunk) { setText(''); setBad(false) } }, [isChunk, hours])
  function commit(v) {
    setText(v)
    if (!v.trim()) { setBad(false); return }
    const h = parseDuration(v)
    if (h === null || h <= 0 || h > 24) { setBad(true); return }
    setBad(false); onChange(h)
  }
  return (
    <span className="row" style={{ gap: 6 }}>
      <input type="text" inputMode="decimal" aria-label="Other duration, e.g. 3h 20m" placeholder="other, e.g. 3h 20m" className="input"
        style={{ width: 132, height: 30, padding: '0 10px', borderRadius: 999, borderColor: bad ? 'var(--bad)' : !isChunk && hours ? 'var(--charcoal)' : undefined }}
        value={text} onChange={(ev) => commit(ev.target.value)} />
      {!isChunk && hours > 0 && !bad && <span className="tiny muted">= {fmtHours(hours)}</span>}
      {bad && <span className="tiny" style={{ color: 'var(--bad)' }}>try 3h 20m or 3:20</span>}
    </span>
  )
}

function EntryCard({ e, project, workType, workTypes, chunks, onEdit, onChange, onSave, onRemove }) {
  if (!project) return null
  const isChunk = chunks.some((c) => Number(c.hours) === e.hours)
  return (
    <article className={`entry ${e.editing ? 'editing' : ''}`}>
      <div className="strip" style={{ background: project.colour }} />
      <div className="body">
        <div className="row between" style={{ alignItems: 'flex-start', gap: 6 }}>
          <div className="col" style={{ gap: 0, minWidth: 0 }}><span className="title">{project.name}</span><span className="tiny muted">{project.client?.name}</span></div>
          <span className="hrs">{e.hours ? fmtHours(e.hours) : '—'}</span>
        </div>

        {!e.editing && (
          <>
            <div className="row between">
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="tag">{workType?.name || 'Uncategorised'}</span>
                {e.source === 'calendar' && <span className="tiny muted row" style={{ gap: 4 }} title="Added from Outlook"><Calendar width="12" height="12" /> Outlook</span>}
                {e.source === 'copied' && <span className="tiny muted" title="Copied from last week">copied</span>}
              </div>
              <button className="icon-btn" aria-label="Edit entry" onClick={onEdit}><Pencil /></button>
            </div>
            {e.note && <p className="small" style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.35 }}>{e.note}</p>}
          </>
        )}

        {e.editing && (
          <div className="col" style={{ gap: 10, paddingTop: 4 }}>
            <div className="col" style={{ gap: 6 }}>
              <span className="label">How long<Hint size={12} title="How long" text="Tap a pill for the common chunks, or type anything in the box: 3h 20m, 3:20, 200m and 3.33 all work. A half day is 3.75h and a full day is 7.5h." /></span>
              <div className="row wrap" style={{ gap: 6 }}>
                {chunks.map((c) => <button key={c.label} type="button" className={`pill ${Number(c.hours) === e.hours ? 'on' : ''}`} onClick={() => onChange({ hours: Number(c.hours) })}>{c.label}</button>)}
                <DurationInput hours={e.hours} isChunk={isChunk} onChange={(h) => onChange({ hours: h })} />
              </div>
            </div>
            <div className="col" style={{ gap: 6 }}>
              <span className="label">What kind of work<Hint size={12} title="Work type" text="Roughly what you were doing, so reports can show where the time goes. Pick the closest fit. Admins can add or rename these." /></span>
              <div className="row wrap" style={{ gap: 6 }}>
                {workTypes.map((w) => <button key={w.id} type="button" className={`pill ${w.id === e.work_type_id ? 'on violet' : ''}`} onClick={() => onChange({ work_type_id: w.id })}>{w.name}</button>)}
              </div>
            </div>
            <label className="field">Note <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
              <input className="input" style={{ height: 34 }} placeholder="e.g. Scored round-two sifts" value={e.note || ''} onChange={(ev) => onChange({ note: ev.target.value })}
                onKeyDown={(ev) => { if (ev.key === 'Enter') onSave() }} />
            </label>
            <div className="row between" style={{ paddingTop: 2 }}>
              <button className="btn sm ghost danger" onClick={onRemove}>Remove</button>
              <button className="btn sm primary" onClick={onSave}>Save</button>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
