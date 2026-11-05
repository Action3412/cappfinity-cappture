import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { supabase } from '../lib/supabase.js'
import { today, weekStart, addDays, monthRange, quarterRange, fmtHours, longDate } from '../lib/time.js'
import { downloadCSV } from '../lib/data.js'
import { initials } from '../components/Shell.jsx'
import { ChevronR, Download } from '../components/Icons.jsx'
import Hint from '../components/Hint.jsx'
import { WeeklyColumns, HBars, Donut, PersonWeekGrid, CAT } from '../components/Charts.jsx'
import { shortDate, dayName } from '../lib/time.js'

const AVATARS = ['#FDE9A8', '#D8CFFE', '#FED3FB', '#C9D6FD', '#DDEFE5', '#F6D5C9']
const av = (n = '') => AVATARS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]

function periodRange(p, custom) {
  const t = today()
  if (p === 'week') return [weekStart(t), addDays(weekStart(t), 6)]
  if (p === 'lastweek') return [addDays(weekStart(t), -7), addDays(weekStart(t), -1)]
  if (p === 'month') return monthRange()
  if (p === 'quarter') return quarterRange()
  if (p === 'custom') return [custom.from || '2020-01-01', custom.to || t]
  return ['2020-01-01', '2100-01-01']
}

export default function Reports() {
  const { isAdmin, profile } = useAuth()
  const [period, setPeriod] = useState('month')
  const [custom, setCustom] = useState({ from: monthRange()[0], to: today() })
  const [client, setClient] = useState('all')
  const [team, setTeam] = useState('all')
  const [person, setPerson] = useState('all')
  const [workType, setWorkType] = useState('all')
  const [rows, setRows] = useState([])
  const [projectTotals, setProjectTotals] = useState([])
  const [shortfalls, setShortfalls] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showRates, setShowRates] = useState(false)
  const [gran, setGran] = useState('week') // day | week | month | quarter | year
  const [toast, setToast] = useState('')
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  const [from, to] = periodRange(period, custom)
  const lastWeek = addDays(weekStart(today()), -7)

  useEffect(() => {
    let dead = false
    setLoading(true)
    Promise.all([
      supabase.from('v_entries').select('*').gte('entry_date', from).lte('entry_date', to).order('entry_date'),
      supabase.from('v_project_totals').select('*'),
      supabase.rpc('week_shortfalls', { p_week_start: lastWeek }),
    ]).then(([e, p, s]) => {
      if (dead) return
      setRows((e.data || []).map((r) => ({ ...r, hours: Number(r.hours) })))
      setProjectTotals(p.data || [])
      setShortfalls(s.data || [])
      setLoading(false)
    })
    return () => { dead = true }
  }, [from, to, lastWeek])

  const options = useMemo(() => ({
    clients: [...new Set(rows.map((r) => r.client))].sort(),
    teams: [...new Set(rows.map((r) => r.team).filter(Boolean))].sort(),
    people: [...new Map(rows.map((r) => [r.profile_id, r.person || r.email])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    workTypes: [...new Set(rows.map((r) => r.work_type).filter(Boolean))].sort(),
  }), [rows])

  const scoped = useMemo(() => rows.filter((r) =>
    (client === 'all' || r.client === client) && (team === 'all' || r.team === team) &&
    (person === 'all' || r.profile_id === person) && (workType === 'all' || r.work_type === workType)), [rows, client, team, person, workType])

  const wtNames = useMemo(() => [...new Set(rows.map((r) => r.work_type || 'Uncategorised'))].sort(), [rows])

  // client → project → person
  const tree = useMemo(() => {
    const byClient = new Map()
    scoped.forEach((r) => {
      if (!byClient.has(r.client_id)) byClient.set(r.client_id, { id: r.client_id, name: r.client, internal: r.is_internal, logged: 0, projects: new Map() })
      const c = byClient.get(r.client_id); c.logged += r.hours
      if (!c.projects.has(r.project_id)) c.projects.set(r.project_id, { id: r.project_id, name: r.project, code: r.project_code, colour: r.colour, budget: Number(r.budget_hours), billable: r.billable, logged: 0, people: new Map() })
      const p = c.projects.get(r.project_id); p.logged += r.hours
      const key = r.profile_id
      if (!p.people.has(key)) p.people.set(key, { id: key, name: r.person || r.email, team: r.team || '—', total: 0, byType: {} })
      const pp = p.people.get(key); pp.total += r.hours; const wt = r.work_type || 'Uncategorised'; pp.byType[wt] = (pp.byType[wt] || 0) + r.hours
    })
    return [...byClient.values()].sort((a, b) => (a.internal - b.internal) || b.logged - a.logged)
      .map((c) => ({ ...c, projects: [...c.projects.values()].sort((a, b) => b.logged - a.logged).map((p) => ({ ...p, people: [...p.people.values()].sort((a, b) => b.total - a.total) })) }))
  }, [scoped])

  const totalLogged = scoped.reduce((a, r) => a + r.hours, 0)
  const billable = scoped.reduce((a, r) => a + (r.billable ? r.hours : 0), 0)
  const projectIdsInScope = new Set(scoped.map((r) => r.project_id))
  const budgetInScope = projectTotals.filter((p) => projectIdsInScope.has(p.project_id) && Number(p.budget_hours) > 0)
  const budgetAlloc = budgetInScope.reduce((a, p) => a + Number(p.budget_hours), 0)
  const budgetUsed = budgetInScope.reduce((a, p) => a + Number(p.logged_hours), 0)
  const allTime = Object.fromEntries(projectTotals.map((p) => [p.project_id, Number(p.logged_hours)]))

  const mix = useMemo(() => {
    const m = {}; scoped.forEach((r) => { const k = r.work_type || 'Uncategorised'; m[k] = (m[k] || 0) + r.hours })
    const max = Math.max(1, ...Object.values(m))
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v, w: Math.round((v / max) * 100) }))
  }, [scoped])

  // ---- chart data (all within the current filters)
  const peopleInScope = new Set(scoped.map((r) => r.profile_id)).size
  const dayHours = 7.5
  // Bucket entries by the chosen granularity. Each bucket carries its own target:
  // working days in the bucket (clipped to the selected range) × 7.5h × people in scope.
  const buckets = useMemo(() => {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const keyOf = (d) => {
      const [y, m] = d.split('-').map(Number)
      if (gran === 'day') return d
      if (gran === 'week') return weekStart(d)
      if (gran === 'month') return `${y}-${String(m).padStart(2, '0')}`
      if (gran === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
      return String(y)
    }
    const labelOf = (k) => {
      if (gran === 'day') return `${dayName(k)} ${shortDate(k)}`
      if (gran === 'week') return shortDate(k)
      if (gran === 'month') { const [y, m] = k.split('-').map(Number); return `${MON[m - 1]} ${String(y).slice(2)}` }
      if (gran === 'quarter') { const [y, q] = k.split('-Q'); return `Q${q} ${y}` }
      return k
    }
    const m = new Map()
    scoped.forEach((r) => { const k = keyOf(r.entry_date); if (!m.has(k)) m.set(k, { key: k, label: labelOf(k), billable: 0, internal: 0, days: new Set() }); const b = m.get(k); b[r.billable ? 'billable' : 'internal'] += r.hours })
    // working days per bucket within the selected range
    const lo = from < '2020-01-01' ? (scoped.length ? scoped.reduce((a, r) => (r.entry_date < a ? r.entry_date : a), scoped[0].entry_date) : from) : from
    const latest = scoped.length ? scoped.reduce((a, r) => (r.entry_date > a ? r.entry_date : a), scoped[0].entry_date) : today()
    const hi = to > today() ? (latest > today() ? latest : today()) : to
    for (let d = lo; d <= hi; d = addDays(d, 1)) { const dow = dayName(d); if (dow === 'Sat' || dow === 'Sun') continue; const k = keyOf(d); if (m.has(k)) m.get(k).days.add(d) }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key)).map((b) => ({ ...b, target: b.days.size * dayHours * peopleInScope })).slice(-14)
  }, [scoped, gran, from, to, peopleInScope])
  const bucketTarget = buckets.length ? Math.max(...buckets.map((b) => b.target)) : 0
  const readout = useMemo(() => {
    const tot = buckets.reduce((a, b) => a + b.billable + b.internal, 0)
    const tgt = buckets.reduce((a, b) => a + b.target, 0)
    const bill = buckets.reduce((a, b) => a + b.billable, 0)
    const under = buckets.filter((b) => b.target > 0 && b.billable + b.internal < b.target * 0.9).length
    const unit = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' }[gran]
    return { tot, tgt, bill, under, unit, n: buckets.length }
  }, [buckets, gran])
  const byClient = useMemo(() => {
    const m = {}; scoped.forEach((r) => { m[r.client] = (m[r.client] || 0) + r.hours })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
  }, [scoped])
  const wtOrder = useMemo(() => [...new Set(rows.map((r) => r.work_type || 'Uncategorised'))].sort(), [rows])
  const donut = useMemo(() => {
    const m = {}; scoped.forEach((r) => { const k = r.work_type || 'Uncategorised'; m[k] = (m[k] || 0) + r.hours })
    const all = wtOrder.map((k, i) => ({ label: k, value: m[k] || 0, colour: CAT[i % CAT.length] })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
    if (all.length <= 6) return all
    const top = all.slice(0, 5), rest = all.slice(5).reduce((a, d) => a + d.value, 0)
    return [...top, { label: 'Other', value: rest, colour: '#A2A2AB' }]
  }, [scoped, wtOrder])
  const billableByPerson = useMemo(() => {
    const m = {}; scoped.forEach((r) => { const k = r.person || r.email; m[k] ||= { b: 0, t: 0 }; m[k].t += r.hours; if (r.billable) m[k].b += r.hours })
    return Object.entries(m).map(([label, v]) => ({ label, value: v.t ? Math.round((v.b / v.t) * 100) : 0, sub: `${fmtHours(v.b)} of ${fmtHours(v.t)}` })).sort((a, b) => b.value - a.value)
  }, [scoped])
  const grid = useMemo(() => {
    const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    const m = {}
    scoped.forEach((r) => { const k = r.person || r.email; m[k] ||= { name: k, cells: [0, 0, 0, 0, 0], total: 0 }; const i = dows.indexOf(dayName(r.entry_date)); if (i >= 0) m[k].cells[i] += r.hours; m[k].total += r.hours })
    return { days: dows, people: Object.values(m).sort((a, b) => b.total - a.total).slice(0, 12) }
  }, [scoped])

  function exportCSV(subset = scoped, name = 'cappture') {
    downloadCSV(`${name}-${from}-to-${to}.csv`, subset, [
      { label: 'Date', value: 'entry_date' }, { label: 'Week starting', value: 'week_start' },
      { label: 'Person', value: 'person' }, { label: 'Email', value: 'email' }, { label: 'Team', value: 'team' },
      { label: 'Client', value: 'client' }, { label: 'Project', value: 'project' }, { label: 'Project code', value: 'project_code' },
      { label: 'Billable', value: (r) => (r.billable ? 'Yes' : 'No') }, { label: 'Work type', value: 'work_type' },
      { label: 'Hours', value: 'hours' }, { label: 'Note', value: 'note' }, { label: 'Source', value: 'source' },
    ])
  }

  async function remind(s) {
    const { error } = await supabase.from('reminder_log').insert({ profile_id: s.profile_id, week_start: lastWeek, kind: 'manual', sent_by: profile.id })
    if (error) { flash(error.message); return }
    setShortfalls((x) => x.map((y) => (y.profile_id === s.profile_id ? { ...y, reminded_at: new Date().toISOString() } : y)))
    flash('Reminder noted. Automatic emails switch on with the Outlook phase')
  }
  async function remindAll() {
    const pending = shortfalls.filter((s) => !s.reminded_at)
    if (!pending.length) return
    const { error } = await supabase.from('reminder_log').insert(pending.map((s) => ({ profile_id: s.profile_id, week_start: lastWeek, kind: 'manual', sent_by: profile.id })))
    if (error) { flash(error.message); return }
    const now = new Date().toISOString()
    setShortfalls((x) => x.map((y) => ({ ...y, reminded_at: y.reminded_at || now })))
    flash(`Noted ${pending.length} reminders`)
  }

  const scopeLabel = [client === 'all' ? 'All clients' : client, team === 'all' ? 'all teams' : `${team} team`, person === 'all' ? '' : options.people.find((p) => p[0] === person)?.[1], `${longDate(from)} – ${longDate(to)}`].filter(Boolean).join(' · ')
  const sel = { height: 36 }

  return (
    <div className="page col" style={{ gap: 18 }}>
      <div className="row between wrap" style={{ alignItems: 'flex-end', gap: 14 }}>
        <div className="col" style={{ gap: 4 }}><span className="row" style={{ gap: 8 }}><h1>Allocated vs actual</h1><Hint title="Reports" text="Who spent how long on what. Use the filters to narrow it down by date, client, team, person or work type. Every number on this page updates to match. Export CSV gives you the raw entries behind whatever you're looking at, ready for Excel." /></span><span className="small muted">{scopeLabel}</span></div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="filterbar" role="group" aria-label="Report filters">
            <label className="filter"><span>Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="week">This week</option><option value="lastweek">Last week</option><option value="month">This month</option>
                <option value="quarter">This quarter</option><option value="all">All time</option><option value="custom">Custom…</option>
              </select></label>
            {period === 'custom' && (<>
              <label className="filter"><span>From</span><input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
              <label className="filter"><span>To</span><input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
            </>)}
            <label className="filter"><span>Client</span><select value={client} onChange={(e) => setClient(e.target.value)}><option value="all">All clients</option>{options.clients.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="filter"><span>Team</span><select value={team} onChange={(e) => setTeam(e.target.value)}><option value="all">All teams</option>{options.teams.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="filter"><span>Person</span><select value={person} onChange={(e) => setPerson(e.target.value)}><option value="all">Everyone</option>{options.people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
            <label className="filter"><span>Work type</span><select value={workType} onChange={(e) => setWorkType(e.target.value)}><option value="all">All types</option>{options.workTypes.map((c) => <option key={c}>{c}</option>)}</select></label>
            {(client !== 'all' || team !== 'all' || person !== 'all' || workType !== 'all') && <button type="button" className="filter-clear" onClick={() => { setClient('all'); setTeam('all'); setPerson('all'); setWorkType('all') }} aria-label="Clear filters">Clear</button>}
          </div>
          <button className="btn primary" style={{ height: 48, borderRadius: 14 }} onClick={() => exportCSV()} disabled={!scoped.length}><Download /> Export CSV</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi dark"><span className="small" style={{ opacity: .7 }}>Hours logged<Hint title="Hours logged" text="Total hours in the current filters, with the billable share underneath. Billable means time on client projects rather than internal ones." /></span><b>{fmtHours(totalLogged)}</b><span className="small" style={{ opacity: .7 }}>{fmtHours(billable)} billable · {scoped.length} entries</span></div>
        <div className="kpi"><span className="small muted">Billable share<Hint title="Billable share" text="The percentage of logged hours that went on client work. A useful health check for a team or a person: low means a lot of pitching, admin or leave in the period." /></span><b>{totalLogged ? Math.round((billable / totalLogged) * 100) : 0}%</b><div className="bar"><div style={{ width: `${totalLogged ? Math.round((billable / totalLogged) * 100) : 0}%`, background: 'var(--spectrum)' }} /></div></div>
        <div className="kpi"><span className="small muted">Budget used <span className="tiny">(project to date)</span><Hint title="Budget used" text="For projects that have a budget, how much of it has been used so far. This one always looks at the whole life of each project, not just the dates you've filtered to, because a budget is a total not a monthly figure." /></span><b>{budgetAlloc ? `${Math.round((budgetUsed / budgetAlloc) * 100)}%` : '—'}</b><span className="small muted">{budgetAlloc ? `${fmtHours(budgetUsed)} of ${budgetAlloc}h across ${budgetInScope.length} budgeted ${budgetInScope.length === 1 ? 'project' : 'projects'}` : 'no budgeted projects in scope'}</span></div>
        <div className="kpi"><span className="small muted">Short of target last week<Hint align="right" title="Short of target" text="People who logged less than their weekly target (normally 37.5h) last week. The full list, with a Remind button for each, is further down the page." /></span><b style={{ color: shortfalls.length ? 'var(--bad)' : 'var(--ok)' }}>{shortfalls.length}</b><span className="small muted">{isAdmin ? 'across everyone' : 'in your team'} · week of {longDate(lastWeek)}</span></div>
      </div>

      {!loading && scoped.length > 0 && (
        <>
          <div className="charts">
            <section className="dark chart-card">
              <div className="row between wrap" style={{ gap: 10 }}>
                <h2>Hours logged over time<Hint title="Hours over time" text="Each column is one day, week, month, quarter or year, depending on the switch. The gradient part is billable client work, the lighter cap is internal time. The number on top is the total. The gold dashed line is the target for that period: working days × 7.5h × the number of people in scope. A column that falls well short of the line means time isn't being captured, not that people weren't working." /></h2>
                <div className="seg dark-seg" role="tablist" aria-label="Chart granularity">
                  {[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={gran === k} className={gran === k ? 'on' : ''} onClick={() => setGran(k)}>{l}</button>)}
                </div>
              </div>
              <span className="sub">{peopleInScope} {peopleInScope === 1 ? 'person' : 'people'} in scope · by {readout.unit}{buckets.length >= 14 ? ' · last 14 shown' : ''}</span>
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
              <h2>Hours by client<Hint title="Hours by client" text="Total hours per client in the current filters, biggest first. Internal shows up here too so you can see client work against everything else." /></h2>
              <span className="sub">Biggest first, with share of the total</span>
              <HBars data={byClient} showShare />
            </section>
            <section className="panel chart-card">
              <h2>Billable share by person<Hint title="Billable share" text="The percentage of each person's logged hours that went on client work, highest first. Hover a row for the hours behind it. Low isn't necessarily bad: pitch and leadership roles will sit lower." /></h2>
              <span className="sub">Client hours as a share of everything logged</span>
              <HBars data={billableByPerson} format={(v) => String(v)} suffix="%" max={100} gradient="linear-gradient(90deg, #FDB601, #FB6CF5)" />
            </section>
          </div>
          {grid.people.length > 1 && (
            <section className="panel chart-card">
              <h2>Who logged what, by weekday<Hint title="By weekday" text="Hours per person per weekday across the range, darker is more. Pale Fridays and empty Mondays usually mean people are catching up at the end of the week rather than logging as they go." /></h2>
              <span className="sub">Darker means more hours</span>
              <PersonWeekGrid people={grid.people} days={grid.days} />
            </section>
          )}
        </>
      )}

      <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
        <section className="panel" style={{ flex: '999 1 600px', minWidth: 0, overflow: 'hidden' }}>
          <div className="panel-h"><h2>By client and project<Hint title="By client and project" text="Grouped by client, then project. Click a project row to open it up and see each person's hours split by work type. Download this project gives you just that project's entries as a CSV." /></h2><div className="row"><span className="small muted">Click a project to see who logged what</span>{isAdmin && <span className="row" style={{ gap: 4 }}><button className="btn sm" onClick={() => setShowRates((s) => !s)}>{showRates ? 'Hide' : 'Show'} rates</button><Hint align="right" title="Rates" text="Adds a rate column to the people breakdown so you can see cost or value against hours. Admins only. Rates aren't set up yet, so it shows 'not set' for now." /></span>}</div></div>
          <div className="scroll-x">
            <table className="tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>Project</th><th className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>Allocated<Hint align="right" title="Allocated" text="The project's total hours budget, set by an admin. A dash means the project has no budget, which is normal for internal work." /></span></th><th className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>Logged<Hint align="right" title="Logged" text="Hours logged against the project within your current filters." /></span></th><th style={{ width: '22%' }}><span className="row" style={{ gap: 4 }}>Progress (to date)<Hint title="Progress" text="How much of the budget has been used over the whole life of the project, regardless of the date filter. Gold from 90%, red once it's over." /></span></th><th className="num">People</th><th className="num"><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>Status<Hint align="right" title="Status" text="On track: under 90% of budget used. Nearly out: 90% or more. Over: more hours logged than budgeted. Unbudgeted: no budget set, so nothing to compare against." /></span></th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan="6" className="center">Loading…</td></tr>}
                {!loading && tree.length === 0 && <tr><td colSpan="6" className="center">No time logged in this range.</td></tr>}
                {tree.map((c) => (
                  <GroupRows key={c.id} c={c} expanded={expanded} setExpanded={setExpanded} allTime={allTime} wtNames={wtNames} showRates={showRates} onExport={(p) => exportCSV(scoped.filter((r) => r.project_id === p.id), p.code)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="col" style={{ flex: '1 1 300px', maxWidth: 380, gap: 14 }}>
          <div className="panel panel-b col" style={{ gap: 10 }}>
            <div className="row between"><h2>Short of target last week<Hint title="Short of target" text="Anyone who logged less than their weekly target last week, with how far short they were. Remind notes that you've chased them so nobody gets nudged twice. Once the Outlook phase is in, the Friday and Monday emails go out automatically." /></h2>{shortfalls.some((s) => !s.reminded_at) && <button className="btn sm primary" onClick={remindAll}>Remind all</button>}</div>
            <span className="small muted">Week of {longDate(lastWeek)}. Automatic Friday and Monday emails arrive with the Outlook phase. Until then use this to chase by hand.</span>
            {shortfalls.map((s) => (
              <div className="row" key={s.profile_id} style={{ padding: '8px 0', borderBottom: '1px dotted var(--line)', gap: 10 }}>
                <span className="avatar sm" style={{ background: av(s.person || s.email) }}>{initials(s.person || s.email)}</span>
                <div className="col grow" style={{ gap: 0, minWidth: 0 }}><b className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.person || s.email}</b><span className="tiny muted">{s.team || 'No team'} · {fmtHours(s.logged_hours)} logged</span></div>
                <b className="small" style={{ color: 'var(--bad)', whiteSpace: 'nowrap' }}>−{fmtHours(s.shortfall)}</b>
                {s.reminded_at ? <span className="tag ok">Reminded</span> : <button className="btn sm" onClick={() => remind(s)}>Remind</button>}
              </div>
            ))}
            {!shortfalls.length && !loading && <div className="note info">Everyone hit their target.</div>}
          </div>
        </aside>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function GroupRows({ c, expanded, setExpanded, allTime, wtNames, showRates, onExport }) {
  return (
    <>
      <tr className="group"><td>{c.name}</td><td className="num muted">{c.projects.reduce((a, p) => a + p.budget, 0) ? `${c.projects.reduce((a, p) => a + p.budget, 0)}h` : ''}</td><td className="num">{fmtHours(c.logged)}</td><td /><td /><td /></tr>
      {c.projects.map((p) => {
        const toDate = allTime[p.id] ?? p.logged
        const pct = p.budget ? Math.round((toDate / p.budget) * 100) : 0
        const over = p.budget && toDate > p.budget
        const status = !p.budget ? 'Unbudgeted' : over ? 'Over' : pct >= 90 ? 'Nearly out' : 'On track'
        const cls = status === 'Over' ? 'bad' : status === 'Nearly out' ? 'warn' : status === 'Unbudgeted' ? 'grey' : 'ok'
        const open = expanded === p.id
        return (
          <GroupProject key={p.id} p={p} open={open} toggle={() => setExpanded(open ? null : p.id)} pct={pct} over={over} status={status} cls={cls} toDate={toDate} wtNames={wtNames} showRates={showRates} onExport={() => onExport(p)} />
        )
      })}
    </>
  )
}

function GroupProject({ p, open, toggle, pct, over, status, cls, toDate, wtNames, showRates, onExport }) {
  return (
    <>
      <tr className="click" onClick={toggle} aria-expanded={open}>
        <td><div className="row" style={{ gap: 10 }}><ChevronR width="12" height="12" style={{ color: 'var(--muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} /><span className="swatch" style={{ background: p.colour }} /><div className="col" style={{ gap: 0 }}><b>{p.name}</b><span className="tiny muted">{p.code}{p.billable ? '' : ' · non-billable'}</span></div></div></td>
        <td className="num">{p.budget ? `${p.budget}h` : '—'}</td>
        <td className="num"><b>{fmtHours(p.logged)}</b></td>
        <td><div className="row"><div className="bar grow"><div style={{ width: `${Math.min(100, pct)}%`, background: over ? 'var(--bad)' : pct >= 90 ? 'var(--gold)' : p.colour }} /></div><span className="tiny muted" style={{ width: 70, textAlign: 'right' }}>{p.budget ? `${fmtHours(toDate)} · ${pct}%` : ''}</span></div></td>
        <td className="num">{p.people.length}</td>
        <td className="num"><span className={`tag ${cls}`}>{status}</span></td>
      </tr>
      {open && (
        <tr className="sub"><td colSpan="6" style={{ padding: '6px 16px 14px 44px' }}>
          <div className="scroll-x">
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>Person</th><th>Team</th>{wtNames.map((w) => <th key={w} className="num">{w}</th>)}<th className="num">Total</th>{showRates && <th className="num">Rate</th>}</tr></thead>
              <tbody>
                {p.people.map((pp) => (
                  <tr key={pp.id}><td><div className="row"><span className="avatar sm" style={{ background: av(pp.name) }}>{initials(pp.name)}</span><b>{pp.name}</b></div></td><td className="muted">{pp.team}</td>
                    {wtNames.map((w) => <td key={w} className="num">{pp.byType[w] ? fmtHours(pp.byType[w]) : <span className="muted">–</span>}</td>)}
                    <td className="num"><b>{fmtHours(pp.total)}</b></td>{showRates && <td className="num muted">not set</td>}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 10 }}><button className="btn sm" onClick={(e) => { e.stopPropagation(); onExport() }}><Download /> Download this project</button></div>
        </td></tr>
      )}
    </>
  )
}
