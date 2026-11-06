import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { supabase } from '../lib/supabase.js'
import { today, weekStart, addDays, monthRange, quarterRange, fmtHours, longDate, shortDate, dayName } from '../lib/time.js'
import { downloadCSV } from '../lib/data.js'
import { initials } from '../components/Shell.jsx'
import { ChevronR, Download } from '../components/Icons.jsx'
import Hint from '../components/Hint.jsx'
import Combo from '../components/Combo.jsx'
import { WeeklyColumns, HBars, Donut, PersonWeekGrid, CAT } from '../components/Charts.jsx'
import PersonBoard from '../components/PersonBoard.jsx'
import Empty from '../components/Empty.jsx'

const AVATARS = ['#FDE9A8', '#D8CFFE', '#FED3FB', '#C9D6FD', '#DDEFE5', '#F6D5C9']
const av = (n = '') => AVATARS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]
const FILTER_KEY = 'cappture.reports.filters.v2'
const N = (v) => Number(v || 0)
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1

function periodRange(p, custom) {
  const t = today()
  if (p === 'week') return [weekStart(t), addDays(weekStart(t), 6)]
  if (p === 'lastweek') return [addDays(weekStart(t), -7), addDays(weekStart(t), -1)]
  if (p === 'last4') return [addDays(weekStart(t), -28), addDays(weekStart(t), -1)]
  if (p === 'month') return monthRange()
  if (p === 'quarter') return quarterRange()
  if (p === 'custom') return [custom.from || '2020-01-01', custom.to || t]
  return ['2020-01-01', '2100-01-01']
}
function autoGran(days) { return days <= 14 ? 'day' : days <= 120 ? 'week' : days <= 740 ? 'month' : 'quarter' }

function loadSaved() { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || 'null') } catch { return null } }

export default function Reports() {
  const { isAdmin, profile, settings } = useAuth()
  const approvalsOn = settings?.require_approval === true || settings?.require_approval === 'true'
  const saved = useMemo(loadSaved, [])
  // Admins land on their own team the first time, not the whole company
  const [period, setPeriod] = useState(saved?.period || 'month')
  const [custom, setCustom] = useState(saved?.custom || { from: monthRange()[0], to: today() })
  const [client, setClient] = useState(saved?.client || 'all')
  const [team, setTeam] = useState(saved?.team || (isAdmin && profile?.team_id ? profile.team_id : 'all'))
  const [person, setPerson] = useState(saved?.person || 'all')
  const [workType, setWorkType] = useState(saved?.workType || 'all')
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ period, custom, client, team, person, workType })) } catch {} }, [period, custom, client, team, person, workType])

  const [data, setData] = useState(null)
  const [queue, setQueue] = useState([])
  const [shortfalls, setShortfalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showRates, setShowRates] = useState(false)
  const [gran, setGran] = useState(null) // null = automatic
  const [toast, setToast] = useState('')
  const toastT = useRef(null)
  const flash = (m, ms = 2500) => { setToast(m); clearTimeout(toastT.current); if (ms) toastT.current = setTimeout(() => setToast(''), ms) }

  const [from, to] = periodRange(period, custom)
  const lastWeek = addDays(weekStart(today()), -7)
  const args = useMemo(() => ({ p_from: from, p_to: to, p_client: client === 'all' ? null : client, p_team: team === 'all' ? null : team, p_person: person === 'all' ? null : person, p_work_type: workType === 'all' ? null : workType }), [from, to, client, team, person, workType])

  const seq = useRef(0)
  useEffect(() => {
    const my = ++seq.current
    setLoading(true); setErr('')
    Promise.all([
      supabase.rpc('report_summary', args),
      supabase.rpc('week_shortfalls', { p_week_start: lastWeek }),
      supabase.rpc('approvals_queue'),
    ]).then(([r, s, q]) => {
      if (my !== seq.current) return
      if (r.error) setErr(r.error.message)
      setData(r.data || null)
      setShortfalls(s.data || [])
      setQueue(q.data || [])
      setLoading(false)
    })
  }, [args, lastWeek])

  const options = data?.options || { clients: [], teams: [], people: [], work_types: [] }
  // A selection that stops being valid under the other filters resets itself
  useEffect(() => {
    if (!data) return
    if (client !== 'all' && !options.clients.some((o) => o.id === client)) setClient('all')
    if (team !== 'all' && !options.teams.some((o) => o.id === team)) setTeam('all')
    if (person !== 'all' && !options.people.some((o) => o.id === person)) setPerson('all')
    if (workType !== 'all' && !options.work_types.some((o) => o.id === workType)) setWorkType('all')
  }, [data]) // eslint-disable-line

  const scope = data?.scope || { entries: 0, people: 0, hours: 0, billable: 0 }
  const totalLogged = N(scope.hours), billable = N(scope.billable), peopleInScope = N(scope.people), entries = N(scope.entries)
  const projects = data?.projects || []
  const budgeted = projects.filter((p) => N(p.budget) > 0)
  const budgetAlloc = budgeted.reduce((a, p) => a + N(p.budget), 0)
  const budgetUsed = budgeted.reduce((a, p) => a + N(p.all_time), 0)

  // ---- over time: bucket the per-day totals; each bucket's target = working days × 7.5 × people in scope
  const rangeDays = daysBetween(from, to > today() ? today() : to)
  const g = gran || autoGran(rangeDays)
  const dayHours = 7.5
  const buckets = useMemo(() => {
    const days = data?.by_day || []
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const keyOf = (d) => { const [y, m] = d.split('-').map(Number); if (g === 'day') return d; if (g === 'week') return weekStart(d); if (g === 'month') return `${y}-${String(m).padStart(2, '0')}`; if (g === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`; return String(y) }
    const labelOf = (k) => { if (g === 'day') return `${dayName(k)} ${shortDate(k)}`; if (g === 'week') return shortDate(k); if (g === 'month') { const [y, m] = k.split('-').map(Number); return `${MON[m - 1]} ${String(y).slice(2)}` } if (g === 'quarter') { const [y, q] = k.split('-Q'); return `Q${q} ${y}` } return k }
    const m = new Map()
    days.forEach((r) => { const k = keyOf(r.d); if (!m.has(k)) m.set(k, { key: k, label: labelOf(k), billable: 0, internal: 0, days: new Set() }); const b = m.get(k); b.billable += N(r.billable); b.internal += N(r.internal) })
    const lo = from < '2020-01-01' ? (scope.first_day || from) : from
    const latest = scope.last_day || today()
    const hi = to > today() ? (latest > today() ? latest : today()) : to
    for (let d = lo; d <= hi; d = addDays(d, 1)) { const dow = dayName(d); if (dow === 'Sat' || dow === 'Sun') continue; const k = keyOf(d); if (m.has(k)) m.get(k).days.add(d) }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({ ...b, target: b.days.size * dayHours * peopleInScope })).slice(-16)
  }, [data, g, from, to, peopleInScope]) // eslint-disable-line
  const bucketTarget = buckets.length ? Math.max(...buckets.map((b) => b.target)) : 0
  const readout = useMemo(() => {
    const tot = buckets.reduce((a, b) => a + b.billable + b.internal, 0), tgt = buckets.reduce((a, b) => a + b.target, 0), bill = buckets.reduce((a, b) => a + b.billable, 0)
    const under = buckets.filter((b) => b.target > 0 && b.billable + b.internal < b.target * 0.9).length
    return { tot, tgt, bill, under, unit: g, n: buckets.length }
  }, [buckets, g])

  // ---- widgets
  const wtOrder = useMemo(() => (data?.by_work_type || []).map((w) => w.name).sort(), [data])
  const donut = useMemo(() => {
    const all = (data?.by_work_type || []).map((w) => ({ label: w.name, value: N(w.hours), colour: CAT[wtOrder.indexOf(w.name) % CAT.length] })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
    if (all.length <= 6) return all
    return [...all.slice(0, 5), { label: 'Other', value: all.slice(5).reduce((a, d) => a + d.value, 0), colour: '#A2A2AB' }]
  }, [data, wtOrder])
  const [allClients, setAllClients] = useState(false)
  const byClient = useMemo(() => {
    const all = (data?.by_client || []).map((c) => ({ label: c.name, value: N(c.hours) })).sort((a, b) => b.value - a.value)
    if (allClients || all.length <= 10) return all
    return [...all.slice(0, 9), { label: `Other (${all.length - 9})`, value: all.slice(9).reduce((a, d) => a + d.value, 0) }]
  }, [data, allClients])
  const teams = data?.by_team || []
  const people = data?.by_person || []
  const manyPeople = people.length > 12 && teams.length > 1 && team === 'all'

  // ---- projects table state
  const [openClients, setOpenClients] = useState(null) // null = default (all open if few)
  const [pq, setPq] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [expandedRows, setExpandedRows] = useState({})
  const statusOf = (p) => { const b = N(p.budget), td = N(p.all_time); if (!b) return 'Unbudgeted'; if (td > b) return 'Over'; if (td / b >= 0.9) return 'Nearly out'; return 'On track' }
  const tree = useMemo(() => {
    const q = pq.trim().toLowerCase()
    const list = projects.filter((p) => (!q || `${p.name} ${p.code} ${p.client}`.toLowerCase().includes(q)) && (statusF === 'all' || statusOf(p) === statusF))
    const m = new Map()
    list.forEach((p) => { if (!m.has(p.client_id)) m.set(p.client_id, { id: p.client_id, name: p.client, internal: p.is_internal, logged: 0, budget: 0, projects: [] }); const c = m.get(p.client_id); c.logged += N(p.logged); c.budget += N(p.budget); c.projects.push(p) })
    return [...m.values()].sort((a, b) => (a.internal - b.internal) || b.logged - a.logged).map((c) => ({ ...c, projects: c.projects.sort((a, b) => N(b.logged) - N(a.logged)) }))
  }, [projects, pq, statusF])
  const isOpen = (cid) => openClients ? openClients.has(cid) : (tree.length <= 4 || pq.length > 0)
  const toggleClient = (cid) => setOpenClients((s) => { const n = new Set(s || (tree.length <= 4 ? tree.map((c) => c.id) : [])); n.has(cid) ? n.delete(cid) : n.add(cid); return n })
  async function expandProject(p) {
    if (expanded === p.project_id) { setExpanded(null); return }
    setExpanded(p.project_id)
    if (!expandedRows[p.project_id]) {
      const { data: rows } = await supabase.rpc('report_project_people', { p_project: p.project_id, p_from: from, p_to: to, p_team: args.p_team, p_person: args.p_person, p_work_type: args.p_work_type })
      const byP = new Map()
      ;(rows || []).forEach((r) => { if (!byP.has(r.profile_id)) byP.set(r.profile_id, { id: r.profile_id, name: r.person, team: r.team, total: 0, byType: {} }); const x = byP.get(r.profile_id); x.total += N(r.hours); x.byType[r.work_type] = (x.byType[r.work_type] || 0) + N(r.hours) })
      setExpandedRows((m) => ({ ...m, [p.project_id]: [...byP.values()].sort((a, b) => b.total - a.total) }))
    }
  }
  useEffect(() => { setExpandedRows({}); setExpanded(null) }, [args])

  // ---- exports
  const [exporting, setExporting] = useState(false)
  async function exportSummary() {
    setExporting(true)
    const { data: rows, error } = await supabase.rpc('report_export_summary', args)
    setExporting(false)
    if (error) { flash(error.message); return }
    downloadCSV(`cappture-summary-${from}-to-${to}.csv`, rows || [], [
      { label: 'Person', value: 'person' }, { label: 'Email', value: 'email' }, { label: 'Team', value: 'team' }, { label: 'Client', value: 'client' },
      { label: 'Project', value: 'project' }, { label: 'Project code', value: 'project_code' }, { label: 'Billable', value: (r) => (r.billable ? 'Yes' : 'No') },
      { label: 'Work type', value: 'work_type' }, { label: 'Hours', value: (r) => N(r.hours).toFixed(2) }, { label: 'Entries', value: 'entries' },
    ])
  }
  async function exportRaw(projectId = null, name = 'cappture-entries') {
    // Raw entries come down in pages of 1,000 so a long period still works
    setExporting(true)
    const all = []
    const PAGE = 1000, MAX = 100000
    for (let off = 0; off < MAX; off += PAGE) {
      let q = supabase.from('v_entries').select('entry_date, week_start, person, email, team, client, project, project_code, billable, work_type, hours, note, source')
        .gte('entry_date', from).lte('entry_date', to).order('entry_date').order('person').range(off, off + PAGE - 1)
      if (args.p_client) q = q.eq('client_id', args.p_client)
      if (args.p_team) q = q.eq('team_id', args.p_team)
      if (args.p_person) q = q.eq('profile_id', args.p_person)
      if (args.p_work_type) q = q.eq('work_type_id', args.p_work_type)
      if (projectId) q = q.eq('project_id', projectId)
      const { data: page, error } = await q
      if (error) { setExporting(false); flash(error.message); return }
      all.push(...(page || []))
      if (!page || page.length < PAGE) break
      flash(`Fetching… ${all.length.toLocaleString()} entries`, 0)
    }
    setExporting(false); setToast('')
    if (all.length >= MAX) flash('That export was capped at 100,000 entries. Narrow the period or use the summary export.', 5000)
    downloadCSV(`${name}-${from}-to-${to}.csv`, all, [
      { label: 'Date', value: 'entry_date' }, { label: 'Week starting', value: 'week_start' }, { label: 'Person', value: 'person' }, { label: 'Email', value: 'email' }, { label: 'Team', value: 'team' },
      { label: 'Client', value: 'client' }, { label: 'Project', value: 'project' }, { label: 'Project code', value: 'project_code' }, { label: 'Billable', value: (r) => (r.billable ? 'Yes' : 'No') },
      { label: 'Work type', value: 'work_type' }, { label: 'Hours', value: 'hours' }, { label: 'Note', value: 'note' }, { label: 'Source', value: 'source' },
    ])
  }
  const [exportOpen, setExportOpen] = useState(false)

  // ---- approvals / reminders
  async function decide(q, status) {
    let note = null
    if (status === 'returned') { note = prompt(`What should ${q.person?.split(' ')[0] || 'they'} fix?`); if (note === null) return }
    const { data: d, error } = await supabase.rpc('decide_week', { p_profile: q.profile_id, p_week_start: q.week_start, p_status: status, p_note: note })
    if (error) { flash(error.message); return }
    setQueue((qs) => qs.map((x) => (x.id === q.id ? { ...x, status: d.status, decided_at: d.decided_at, note: d.note } : x)))
    flash(status === 'approved' ? 'Week approved' : 'Sent back with your note')
  }
  async function remind(list) {
    const pending = list.filter((s) => !s.reminded_at)
    if (!pending.length) return
    const { error } = await supabase.from('reminder_log').insert(pending.map((s) => ({ profile_id: s.profile_id, week_start: lastWeek, kind: 'manual', sent_by: profile.id })))
    if (error) { flash(error.message); return }
    const now = new Date().toISOString(), ids = new Set(pending.map((s) => s.profile_id))
    setShortfalls((x) => x.map((y) => (ids.has(y.profile_id) ? { ...y, reminded_at: now } : y)))
    flash(pending.length === 1 ? 'Reminder noted. Automatic emails switch on with the Outlook phase' : `Noted ${pending.length} reminders`)
  }
  const shortByTeam = useMemo(() => {
    const m = new Map()
    shortfalls.forEach((s) => { const k = s.team || 'No team'; if (!m.has(k)) m.set(k, { team: k, people: [] }); m.get(k).people.push(s) })
    return [...m.values()].map((t) => ({ ...t, short: t.people.reduce((a, s) => a + N(s.shortfall), 0) })).sort((a, b) => b.short - a.short)
  }, [shortfalls])
  const [openShort, setOpenShort] = useState(null)
  const [approvalTeam, setApprovalTeam] = useState('all')
  const waiting = queue.filter((q) => q.status === 'submitted')
  const approvalTeams = [...new Set(waiting.map((q) => q.team || 'No team'))].sort()
  const waitingShown = waiting.filter((q) => approvalTeam === 'all' || (q.team || 'No team') === approvalTeam)

  const personName = options.people.find((p) => p.id === person)?.name
  const scopeLabel = [client === 'all' ? 'All clients' : options.clients.find((c) => c.id === client)?.name, team === 'all' ? 'all teams' : `${options.teams.find((t) => t.id === team)?.name || ''} team`, personName, `${longDate(from)} – ${longDate(to)}`].filter(Boolean).join(' · ')
  const anyFilter = client !== 'all' || team !== 'all' || person !== 'all' || workType !== 'all'
  const empty = !loading && entries === 0

  return (
    <div className="page col" style={{ gap: 18 }}>
      <div className="row between wrap" style={{ alignItems: 'flex-end', gap: 14 }}>
        <div className="col" style={{ gap: 4 }}><span className="row" style={{ gap: 8 }}><h1>Allocated vs actual</h1><Hint title="Reports" text="Who spent how long on what. Use the filters to narrow it down by date, client, team, person or work type. Every number on this page updates to match. The totals are worked out in the database, so the page stays quick however many people are logging or how far back you look." /></span><span className="small muted">{scopeLabel}{peopleInScope ? ` · ${peopleInScope} ${peopleInScope === 1 ? 'person' : 'people'}` : ''}</span></div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="filterbar" role="group" aria-label="Report filters">
            <label className="filter"><span>Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="week">This week</option><option value="lastweek">Last week</option><option value="last4">Last 4 weeks</option><option value="month">This month</option>
                <option value="quarter">This quarter</option><option value="all">All time</option><option value="custom">Custom…</option>
              </select></label>
            {period === 'custom' && (<>
              <label className="filter"><span>From</span><input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
              <label className="filter"><span>To</span><input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
            </>)}
            <label className="filter"><span>Client</span><select value={client} onChange={(e) => setClient(e.target.value)}><option value="all">All clients</option>{options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="filter"><span>Team</span><select value={team} onChange={(e) => setTeam(e.target.value)}><option value="all">All teams</option>{options.teams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="filter"><span>Person</span><Combo options={options.people.map((p) => ({ id: p.id, name: p.name, sub: p.team || '' }))} value={person} onChange={setPerson} allLabel="Everyone" ariaLabel="Person" /></label>
            <label className="filter"><span>Work type</span><select value={workType} onChange={(e) => setWorkType(e.target.value)}><option value="all">All types</option>{options.work_types.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            {anyFilter && <button type="button" className="filter-clear" onClick={() => { setClient('all'); setTeam('all'); setPerson('all'); setWorkType('all') }} aria-label="Clear filters">Clear</button>}
          </div>
          <div className="exp-wrap">
            <button className="btn primary" style={{ height: 48, borderRadius: 14 }} onClick={() => setExportOpen((o) => !o)} disabled={empty || exporting}><Download /> {exporting ? 'Exporting…' : 'Export'}</button>
            {exportOpen && (
              <div className="exp-menu" onMouseLeave={() => setExportOpen(false)}>
                <button onClick={() => { setExportOpen(false); exportSummary() }}><b>Summary</b><span className="tiny muted">Hours by person, client, project and work type. One row per combination. The file finance wants.</span></button>
                <button onClick={() => { setExportOpen(false); exportRaw() }}><b>Every entry</b><span className="tiny muted">One row per time block with date, note and source. {entries.toLocaleString()} rows for this view.</span></button>
              </div>
            )}
          </div>
        </div>
      </div>

      {err && <div className="banner warn" style={{ display: 'flex' }}>{err}</div>}
      {loading && !data && <div className="kpis" aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 96 }} />)}</div>}
      <div className="kpis" style={{ display: loading && !data ? 'none' : undefined, opacity: loading ? .6 : 1, transition: 'opacity .2s' }}>
        <div className="kpi dark"><span className="small" style={{ opacity: .7 }}>Hours logged<Hint title="Hours logged" text="Total hours in the current filters, with the billable share underneath. Billable means time on client projects rather than internal ones." /></span><b>{fmtHours(totalLogged)}</b><span className="small" style={{ opacity: .7 }}>{fmtHours(billable)} billable · {entries.toLocaleString()} entries</span></div>
        <div className="kpi"><span className="small muted">Billable share<Hint title="Billable share" text="The percentage of logged hours that went on client work. A useful health check for a team or a person: low means a lot of pitching, admin or leave in the period." /></span><b>{totalLogged ? Math.round((billable / totalLogged) * 100) : 0}%</b><div className="bar"><div style={{ width: `${totalLogged ? Math.round((billable / totalLogged) * 100) : 0}%`, background: 'var(--spectrum)' }} /></div></div>
        <div className="kpi"><span className="small muted">Budget used <span className="tiny">(project to date)</span><Hint title="Budget used" text="For projects that have a budget, how much of it has been used so far. This one always looks at the whole life of each project, not just the dates you've filtered to, because a budget is a total not a monthly figure." /></span><b>{budgetAlloc ? `${Math.round((budgetUsed / budgetAlloc) * 100)}%` : '—'}</b><span className="small muted">{budgetAlloc ? `${fmtHours(budgetUsed)} of ${budgetAlloc}h across ${budgeted.length} budgeted ${budgeted.length === 1 ? 'project' : 'projects'}` : 'no budgeted projects in scope'}</span></div>
        <div className="kpi"><span className="small muted">Short of target last week<Hint align="right" title="Short of target" text="People who logged less than their weekly target (normally 37.5h) last week. The full list, grouped by team with a Remind button for each, is further down the page." /></span><b style={{ color: shortfalls.length ? 'var(--bad)' : 'var(--ok)' }}>{shortfalls.length}</b><span className="small muted">{isAdmin ? 'across everyone' : 'in your team'} · week of {longDate(lastWeek)}</span></div>
      </div>

      {empty && <section className="panel" style={{ marginTop: 14 }}><Empty kind="report" title="Nothing logged for this view" text="Widen the period or clear a filter. Hours appear here as soon as someone logs them." /></section>}
      {data && entries > 0 && (
        <>
          <div className="charts">
            <section className="dark chart-card">
              <div className="row between wrap" style={{ gap: 10 }}>
                <h2>Hours logged over time<Hint title="Hours over time" text="Each column is one day, week, month, quarter or year. The gradient part is billable client work, the lighter cap is internal time. The gold dashed line is the target for that period: working days × 7.5h × the number of people in scope. A column well short of the line means time isn't being captured, not that people weren't working. Lunch and breaks are left out because they don't count towards the target. The grouping picks itself from the period; override it with the switch." /></h2>
                <div className="seg dark-seg" role="tablist" aria-label="Chart granularity">
                  {[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={g === k} className={g === k ? 'on' : ''} disabled={k === 'day' && rangeDays > 62} title={k === 'day' && rangeDays > 62 ? 'Day view is for periods up to two months' : ''} onClick={() => setGran(k)}>{l}</button>)}
                </div>
              </div>
              <span className="sub">{peopleInScope} {peopleInScope === 1 ? 'person' : 'people'} in scope · by {g}{buckets.length >= 16 ? ' · last 16 shown' : ''}</span>
              <WeeklyColumns data={buckets} target={bucketTarget} />
              <div className="readout">
                <span><b>{fmtHours(readout.tot)}</b> logged across {readout.n} {readout.unit}{readout.n === 1 ? '' : 's'}{readout.tgt ? <>, <b>{Math.round((readout.tot / readout.tgt) * 100)}%</b> of the {fmtHours(readout.tgt)} target</> : ''}.</span>
                <span><b>{readout.tot ? Math.round((readout.bill / readout.tot) * 100) : 0}%</b> billable ({fmtHours(readout.bill)}).</span>
                {readout.under > 0 && <span className="warn"><b>{readout.under}</b> {readout.under === 1 ? readout.unit : readout.unit + 's'} under 90% of target.</span>}
                {readout.tgt > 0 && readout.under === 0 && <span className="ok">Every {readout.unit} is within 10% of target.</span>}
              </div>
            </section>
            <section className="panel chart-card">
              <h2>Where the time went<Hint title="Where the time went" text="Share of hours by work type within the current filters. Handy for spotting a project that's all meetings and no delivery, or a team where QA is getting squeezed." /></h2>
              <span className="sub">By work type</span>
              <Donut data={donut} centreLabel="logged" centreValue={fmtHours(totalLogged)} />
            </section>
          </div>
          <div className="charts-2">
            <section className="panel chart-card">
              <div className="row between"><h2>Hours by client<Hint title="Hours by client" text="Total hours per client in the current filters, biggest first. Internal shows up here too so you can see client work against everything else. With lots of clients the smaller ones roll up into Other; Show all opens them out." /></h2>{(data.by_client || []).length > 10 && <button className="btn sm ghost" onClick={() => setAllClients((a) => !a)}>{allClients ? 'Top 10' : `Show all ${(data.by_client || []).length}`}</button>}</div>
              <span className="sub">Biggest first, with share of the total</span>
              <HBars data={byClient} showShare limit={allClients ? 500 : 10} />
            </section>
            <section className="panel chart-card">
              <h2>Billable share{manyPeople ? ' by team' : ' by person'}<Hint title="Billable share" text="The percentage of logged hours that went on client work. With a whole company in view it shows teams first; click a team to open its people, lowest first, because that's usually who you're looking for. Filter to a team or a person and it goes straight to people. Low isn't necessarily bad: pitch and leadership roles will sit lower." /></h2>
              <span className="sub">Client hours as a share of everything logged{manyPeople ? ' · click a team for its people' : ''}</span>
              {manyPeople ? <TeamDrill teams={teams} people={people} /> : <HBars data={people.map((p) => ({ label: p.name || p.email, value: N(p.hours) ? Math.round((N(p.billable) / N(p.hours)) * 100) : 0, sub: `${fmtHours(N(p.billable))} of ${fmtHours(N(p.hours))}` })).sort((a, b) => a.value - b.value)} format={(v) => String(v)} suffix="%" max={100} gradient="linear-gradient(90deg, #FDB601, #FB6CF5)" limit={people.length > 12 ? 12 : 50} />}
            </section>
          </div>
          {(people.length > 1 || teams.length > 1) && (
            <section className="panel chart-card">
              <h2>Who logged what, by weekday<Hint title="By weekday" text="Hours per weekday across the range, darker is more. Teams show as an average per person so big and small teams compare fairly; click one to open its people. Pale Fridays and empty Mondays usually mean people are catching up at the end of the week rather than logging as they go." /></h2>
              <span className="sub">Darker means more hours{manyPeople ? ' · teams are averages per person, click to open' : ''}</span>
              {manyPeople ? <TeamGrid teams={teams} people={people} /> : <PersonWeekGrid people={people.map((p) => ({ name: p.name || p.email, cells: (p.dow || []).map(N), total: N(p.hours) })).sort((a, b) => b.total - a.total).slice(0, 40)} days={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} />}
            </section>
          )}
        </>
      )}

      <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
        <section className="panel" style={{ flex: '999 1 600px', minWidth: 0, overflow: 'hidden' }}>
          <div className="panel-h"><h2>By client and project<Hint title="By client and project" text="Grouped by client, then project. Click a client to open or close it, click a project to see each person's hours split by work type. Search finds a project or code; the status filter picks out the ones over or nearly out of budget." /></h2>
            <div className="row wrap" style={{ gap: 8 }}>
              <input className="input" style={{ height: 34, width: 200 }} placeholder="Find a project or code…" value={pq} onChange={(e) => setPq(e.target.value)} aria-label="Find a project" />
              <select className="select" style={{ height: 34 }} value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="Status"><option value="all">Any status</option><option>On track</option><option>Nearly out</option><option>Over</option><option>Unbudgeted</option></select>
              {isAdmin && <span className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setShowRates((s) => !s)}>{showRates ? 'Hide' : 'Show'} rates</button><Hint align="right" title="Rates" text="Adds a rate column to the people breakdown so you can see cost or value against hours. Admins only. Rates aren't set up yet, so it shows 'not set' for now." /></span>}
            </div>
          </div>
          <div className="scroll-x">
            <table className="tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>Project</th><th className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>Allocated<Hint align="right" title="Allocated" text="The project's total hours budget, set by an admin. A dash means the project has no budget, which is normal for internal work." /></span></th><th className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>Logged<Hint align="right" title="Logged" text="Hours logged against the project within your current filters." /></span></th><th style={{ width: '22%' }}><span className="row" style={{ gap: 4 }}>Progress (to date)<Hint title="Progress" text="How much of the budget has been used over the whole life of the project, regardless of the date filter. Gold from 90%, red once it's over." /></span></th><th className="num">People</th><th className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>Status<Hint align="right" title="Status" text="On track: under 90% of budget used. Nearly out: 90% or more. Over: more hours logged than budgeted. Unbudgeted: no budget set, so nothing to compare against." /></span></th></tr></thead>
              <tbody>
                {loading && !data && <tr><td colSpan="6" className="center">Loading…</td></tr>}
                {data && tree.length === 0 && <tr><td colSpan="6" className="center">{pq || statusF !== 'all' ? 'Nothing matches.' : 'No time logged in this range.'}</td></tr>}
                {tree.map((c) => (
                  <ClientRows key={c.id} c={c} open={isOpen(c.id)} toggle={() => toggleClient(c.id)} expanded={expanded} onExpand={expandProject} rows={expandedRows} wtNames={wtOrder} showRates={showRates} statusOf={statusOf} onExport={(p) => exportRaw(p.project_id, p.code)} />
                ))}
              </tbody>
            </table>
          </div>
          {tree.length > 0 && <div className="panel-b tiny muted" style={{ paddingTop: 8 }}>{tree.length} {tree.length === 1 ? 'client' : 'clients'} · {tree.reduce((a, c) => a + c.projects.length, 0)} projects with time in this period</div>}
        </section>

        <aside className="col" style={{ flex: '1 1 300px', maxWidth: 380, gap: 14 }}>
          {approvalsOn && (
            <div className="panel panel-b col" style={{ gap: 10 }}>
              <div className="row between"><h2>Weeks to approve<Hint title="Approvals" text="Weeks your people have submitted. Approve locks the week for good. Return sends it back with a note so they can fix it and resubmit. Admins see everyone, managers see their own reports." /></h2>{waiting.length > 0 && <span className="tag warn">{waiting.length} waiting</span>}</div>
              {approvalTeams.length > 1 && <select className="select" style={{ height: 32 }} value={approvalTeam} onChange={(e) => setApprovalTeam(e.target.value)} aria-label="Team"><option value="all">All teams ({waiting.length})</option>{approvalTeams.map((t) => <option key={t}>{t}</option>)}</select>}
              {waitingShown.slice(0, 30).map((q) => (
                <div className="col" key={q.id} style={{ padding: '8px 0', borderBottom: '1px dotted var(--line)', gap: 6 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="avatar sm" style={{ background: av(q.person || q.email) }}>{initials(q.person || q.email)}</span>
                    <div className="col grow" style={{ gap: 0, minWidth: 0 }}><b className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.person || q.email}</b><span className="tiny muted">Week of {longDate(q.week_start)} · {q.team || 'No team'}</span></div>
                    <b className="small" style={{ whiteSpace: 'nowrap', color: Number(q.logged_hours) >= Number(q.weekly_target) ? 'var(--ok)' : 'var(--warn)' }}>{fmtHours(q.logged_hours)}</b>
                  </div>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <a className="btn sm ghost" href={`/week/${q.week_start}`} onClick={(ev) => { ev.preventDefault(); setPerson(q.profile_id); setPeriod('custom'); setCustom({ from: q.week_start, to: addDays(q.week_start, 6) }) }}>View</a>
                    <button className="btn sm" onClick={() => decide(q, 'returned')}>Return</button>
                    <button className="btn sm primary" onClick={() => decide(q, 'approved')}>Approve</button>
                  </div>
                </div>
              ))}
              {waitingShown.length > 30 && <span className="tiny muted">Showing 30 of {waitingShown.length}. Pick a team to narrow it down.</span>}
              {!waiting.length && !loading && <div className="note info">Nothing waiting. Recently decided weeks: {queue.length ? queue.slice(0, 5).map((q) => `${q.person?.split(' ')[0] || q.email} (${q.status})`).join(', ') : 'none yet'}.</div>}
            </div>
          )}
          <div className="panel panel-b col" style={{ gap: 10 }}>
            <div className="row between"><h2>Short of target last week<Hint title="Short of target" text="Anyone who logged less than their weekly target last week, grouped by team with how far short they were. Remind notes that you've chased them so nobody gets nudged twice. Once the Outlook phase is in, the Friday and Monday emails go out automatically." /></h2>{shortfalls.some((s) => !s.reminded_at) && <button className="btn sm primary" onClick={() => remind(shortfalls)}>Remind all</button>}</div>
            <span className="small muted">Week of {longDate(lastWeek)}. {shortfalls.length} {shortfalls.length === 1 ? 'person' : 'people'} across {shortByTeam.length} {shortByTeam.length === 1 ? 'team' : 'teams'}.</span>
            {shortByTeam.map((t) => {
              const open = openShort ? openShort === t.team : shortByTeam.length <= 2
              const pending = t.people.filter((s) => !s.reminded_at).length
              return (
                <div key={t.team} className="col" style={{ gap: 0 }}>
                  <button type="button" className="row between" style={{ width: '100%', padding: '8px 0', background: 'none', border: 0, borderBottom: '1px dotted var(--line)', cursor: 'pointer', font: 'inherit', textAlign: 'left' }} onClick={() => setOpenShort(open ? '' : t.team)} aria-expanded={open}>
                    <span className="row" style={{ gap: 8 }}><ChevronR width="12" height="12" style={{ color: 'var(--muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} /><b className="small">{t.team}</b><span className="tiny muted">{t.people.length} {t.people.length === 1 ? 'person' : 'people'}</span></span>
                    <span className="row" style={{ gap: 8 }}><b className="small" style={{ color: 'var(--bad)' }}>−{fmtHours(t.short)}</b>{pending > 0 && <span className="btn sm" role="button" onClick={(e) => { e.stopPropagation(); remind(t.people) }}>Remind {pending}</span>}</span>
                  </button>
                  {open && t.people.map((s) => (
                    <div className="row" key={s.profile_id} style={{ padding: '6px 0 6px 20px', borderBottom: '1px dotted var(--line)', gap: 10 }}>
                      <span className="avatar sm" style={{ background: av(s.person || s.email) }}>{initials(s.person || s.email)}</span>
                      <div className="col grow" style={{ gap: 0, minWidth: 0 }}><b className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.person || s.email}</b><span className="tiny muted">{fmtHours(s.logged_hours)} logged</span></div>
                      <b className="small" style={{ color: 'var(--bad)', whiteSpace: 'nowrap' }}>−{fmtHours(s.shortfall)}</b>
                      {s.reminded_at ? <span className="tag ok">Reminded</span> : <button className="btn sm" onClick={() => remind([s])}>Remind</button>}
                    </div>
                  ))}
                </div>
              )
            })}
            {!shortfalls.length && !loading && <div className="note info">Everyone hit their target.</div>}
          </div>
        </aside>
      </div>
      {person !== 'all' && data && <PersonBoard profileId={person} name={personName || ''} from={from} to={to} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

/* Teams first, people on click. Sorted lowest billable first because that's who you're looking for. */
function TeamDrill({ teams, people }) {
  const [open, setOpen] = useState(null)
  const [low, setLow] = useState(false)
  const pct = (b, t) => (N(t) ? Math.round((N(b) / N(t)) * 100) : 0)
  const rows = teams.map((t) => ({ ...t, pct: pct(t.billable, t.hours) })).sort((a, b) => a.pct - b.pct)
  return (
    <div className="chart col" style={{ gap: 4 }}>
      <label className="row tiny muted" style={{ gap: 6, alignSelf: 'flex-end' }}><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> only people under 50%</label>
      {rows.map((t) => {
        const isOpen = open === (t.id || 'none')
        const ppl = people.filter((p) => (p.team_id || null) === (t.id || null)).map((p) => ({ label: p.name || p.email, value: pct(p.billable, p.hours), sub: `${fmtHours(N(p.billable))} of ${fmtHours(N(p.hours))}` })).filter((p) => !low || p.value < 50).sort((a, b) => a.value - b.value)
        if (low && !ppl.length) return null
        return (
          <div key={t.id || 'none'} className="col" style={{ gap: 2 }}>
            <button type="button" className="hbar click" style={{ width: '100%', background: 'none', border: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen(isOpen ? null : (t.id || 'none'))} aria-expanded={isOpen}>
              <span className="hbar-label row" style={{ gap: 6 }}><ChevronR width="12" height="12" style={{ color: 'var(--muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span><span className="tiny muted">{t.people}</span></span>
              <span className="hbar-track"><span className="hbar-fill" style={{ width: `${Math.max(1.5, t.pct)}%`, background: 'linear-gradient(90deg, #FDB601, #FB6CF5)' }} /></span>
              <span className="hbar-val">{t.pct}%</span>
            </button>
            {isOpen && <div style={{ paddingLeft: 18 }}><HBars data={ppl} format={(v) => String(v)} suffix="%" max={100} gradient="linear-gradient(90deg, #FDB601, #FB6CF5)" limit={200} /></div>}
          </div>
        )
      })}
    </div>
  )
}

/* Weekday grid by team (average per person), click a team for its people */
function TeamGrid({ teams, people }) {
  const [open, setOpen] = useState(null)
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const teamRows = teams.map((t) => ({ id: t.id || 'none', name: `${t.name} (${t.people})`, cells: (t.dow || []).map((v) => N(v) / Math.max(1, N(t.people))), total: N(t.hours) / Math.max(1, N(t.people)) })).sort((a, b) => b.total - a.total)
  const ppl = open ? people.filter((p) => (p.team_id || 'none') === open).map((p) => ({ name: p.name || p.email, cells: (p.dow || []).map(N), total: N(p.hours) })).sort((a, b) => b.total - a.total) : []
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 6 }}>{teamRows.map((t) => <button key={t.id} type="button" className={`pill ${open === t.id ? 'on' : ''}`} onClick={() => setOpen(open === t.id ? null : t.id)}>{t.name}</button>)}</div>
      <PersonWeekGrid people={teamRows} days={days} />
      {open && ppl.length > 0 && <><span className="small muted">People in {teamRows.find((t) => t.id === open)?.name.replace(/ \(\d+\)$/, '')}</span><PersonWeekGrid people={ppl} days={days} /></>}
    </div>
  )
}

function ClientRows({ c, open, toggle, expanded, onExpand, rows, wtNames, showRates, statusOf, onExport }) {
  return (
    <>
      <tr className="group click" onClick={toggle} aria-expanded={open}>
        <td><span className="row" style={{ gap: 8 }}><ChevronR width="12" height="12" style={{ color: 'var(--muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />{c.name}<span className="tiny muted" style={{ fontWeight: 400 }}>{c.projects.length} {c.projects.length === 1 ? 'project' : 'projects'}</span></span></td>
        <td className="num muted">{c.budget ? `${c.budget}h` : ''}</td><td className="num">{fmtHours(c.logged)}</td><td /><td /><td />
      </tr>
      {open && c.projects.map((p) => {
        const toDate = N(p.all_time), budget = N(p.budget)
        const pct = budget ? Math.round((toDate / budget) * 100) : 0
        const status = statusOf(p)
        const cls = status === 'Over' ? 'bad' : status === 'Nearly out' ? 'warn' : status === 'Unbudgeted' ? 'grey' : 'ok'
        const isOpen = expanded === p.project_id
        const ppl = rows[p.project_id]
        return (
          <ProjectRow key={p.project_id} p={p} open={isOpen} toggle={() => onExpand(p)} pct={pct} over={status === 'Over'} status={status} cls={cls} toDate={toDate} ppl={ppl} wtNames={wtNames} showRates={showRates} onExport={() => onExport(p)} />
        )
      })}
    </>
  )
}

function ProjectRow({ p, open, toggle, pct, over, status, cls, toDate, ppl, wtNames, showRates, onExport }) {
  const budget = N(p.budget)
  const types = ppl ? [...new Set(ppl.flatMap((x) => Object.keys(x.byType)))].sort() : wtNames
  return (
    <>
      <tr className="click" onClick={toggle} aria-expanded={open}>
        <td style={{ paddingLeft: 36 }}><div className="row" style={{ gap: 10 }}><ChevronR width="12" height="12" style={{ color: 'var(--muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} /><span className="swatch" style={{ background: p.colour }} /><div className="col" style={{ gap: 0 }}><b>{p.name}</b><span className="tiny muted">{p.code}{p.billable ? '' : ' · non-billable'}</span></div></div></td>
        <td className="num">{budget ? `${budget}h` : '—'}</td>
        <td className="num"><b>{fmtHours(N(p.logged))}</b></td>
        <td><div className="row"><div className="bar grow"><div style={{ width: `${Math.min(100, pct)}%`, background: over ? 'var(--bad)' : pct >= 90 ? 'var(--gold)' : p.colour }} /></div><span className="tiny muted" style={{ width: 70, textAlign: 'right' }}>{budget ? `${fmtHours(toDate)} · ${pct}%` : ''}</span></div></td>
        <td className="num">{p.people}</td>
        <td className="num"><span className={`tag ${cls}`}>{status}</span></td>
      </tr>
      {open && (
        <tr className="sub"><td colSpan="6" style={{ padding: '6px 16px 14px 60px' }}>
          {!ppl && <span className="small muted">Loading…</span>}
          {ppl && (
            <div className="scroll-x">
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead><tr><th>Person</th><th>Team</th>{types.map((w) => <th key={w} className="num">{w}</th>)}<th className="num">Total</th>{showRates && <th className="num">Rate</th>}</tr></thead>
                <tbody>
                  {ppl.map((pp) => (
                    <tr key={pp.id}><td><div className="row"><span className="avatar sm" style={{ background: av(pp.name) }}>{initials(pp.name)}</span><b>{pp.name}</b></div></td><td className="muted">{pp.team}</td>
                      {types.map((w) => <td key={w} className="num">{pp.byType[w] ? fmtHours(pp.byType[w]) : <span className="muted">–</span>}</td>)}
                      <td className="num"><b>{fmtHours(pp.total)}</b></td>{showRates && <td className="num muted">not set</td>}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 10 }}><button className="btn sm" onClick={(e) => { e.stopPropagation(); onExport() }}><Download /> Download this project's entries</button></div>
        </td></tr>
      )}
    </>
  )
}
