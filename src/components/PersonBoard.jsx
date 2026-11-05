import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/auth.jsx'
import { weekStart, weekDays, addDays, today, weekLabel, fmtHours, timeToHours, dayName, shortDate, fmtClock } from '../lib/time.js'
import { DayColumn, TimeGutter, dayRange } from './DayBoard.jsx'
import { ChevronL, ChevronR } from './Icons.jsx'
import Hint from './Hint.jsx'

// Read-only copy of someone's My week, for managers drilling into one person on the Reports page.
// Same clock board, same colours, nothing can be dragged or edited. Clicking a block shows its details.
export default function PersonBoard({ profileId, name, from, to }) {
  const { settings } = useAuth()
  const dayHours = Number(settings.day_hours ?? 7.5)
  const dayStart = timeToHours(settings.day_start) ?? 9
  const dayEnd = timeToHours(settings.day_end) ?? 17.5

  // Start on the latest week of the period that isn't in the future
  const endWeek = weekStart(to < today() ? to : today())
  const [ws, setWs] = useState(endWeek)
  useEffect(() => { setWs(endWeek) }, [endWeek, profileId])
  const days = useMemo(() => weekDays(ws), [ws])

  const [rows, setRows] = useState([])
  const [target, setTarget] = useState(37.5)
  const [open, setOpen] = useState(null) // { e, anchor }
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let dead = false
    setLoading(true)
    Promise.all([
      supabase.from('v_entries').select('*').eq('profile_id', profileId).gte('entry_date', days[0]).lte('entry_date', days[4]).order('start_time'),
      supabase.from('profiles').select('weekly_target').eq('id', profileId).maybeSingle(),
    ]).then(([e, p]) => {
      if (dead) return
      setRows((e.data || []).map((r) => ({ ...r, hours: Number(r.hours) })))
      if (p.data) setTarget(Number(p.data.weekly_target))
      setLoading(false)
    })
    return () => { dead = true }
  }, [profileId, days])

  // Projects and work types as the board expects them, built from the rows themselves
  const projById = useMemo(() => {
    const m = {}
    rows.forEach((r) => { if (!m[r.project_id]) m[r.project_id] = { id: r.project_id, name: r.project, code: r.project_code, colour: r.colour, billable: r.billable, counts_toward_target: r.counts_toward_target, client: { name: r.client, is_internal: r.is_internal } } })
    return m
  }, [rows])
  const wtById = useMemo(() => { const m = {}; rows.forEach((r) => { if (r.work_type_id) m[r.work_type_id] = { id: r.work_type_id, name: r.work_type } }); return m }, [rows])

  const counted = rows.filter((r) => r.counts_toward_target !== false).reduce((a, r) => a + r.hours, 0)
  const range = dayRange(rows, dayStart, dayEnd)
  const t = today()
  const inPeriod = (w) => addDays(w, 4) >= from && w <= to
  const first = name.split(' ')[0] || 'their'

  return (
    <section className="panel panel-b col person-board" style={{ gap: 12, marginTop: 14 }}>
      <div className="row between wrap" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <h2>{name}'s week</h2>
          <Hint title="Drill down" text={`This is ${first}'s My week exactly as they see it, read only. Use the arrows to step through the weeks in the period you've filtered to. Click a block to see its work type and note. Lunch and breaks show on the board but don't count towards the total.`} />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm ghost" aria-label="Previous week" disabled={!inPeriod(addDays(ws, -7))} onClick={() => setWs(addDays(ws, -7))}><ChevronL /></button>
          <b style={{ minWidth: 140, textAlign: 'center' }}>{weekLabel(ws)}</b>
          <button className="btn sm ghost" aria-label="Next week" disabled={!inPeriod(addDays(ws, 7)) || addDays(ws, 7) > t} onClick={() => setWs(addDays(ws, 7))}><ChevronR /></button>
          <span className={`tag ${counted >= target ? 'ok' : counted > 0 ? 'warn' : 'grey'}`} style={{ marginLeft: 6 }}>{fmtHours(counted)} of {target}h</span>
        </div>
      </div>
      <div className="board readonly" style={{ opacity: loading ? .6 : 1 }}>
        <TimeGutter from={range[0]} to={range[1]} dayStart={dayStart} dayEnd={dayEnd} />
        {days.map((d) => (
          <DayColumn key={d} date={d} entries={rows.filter((r) => r.entry_date === d)} dayHours={dayHours} dayStart={dayStart} dayEnd={dayEnd} range={range}
            projById={projById} wtById={wtById} isToday={d === t} isFirst={false} editingId={open?.e.id} locked
            onOpen={(e, el) => setOpen((o) => (o?.e.id === e.id ? null : { e, anchor: el }))} onResize={() => {}} onMove={() => {}} />
        ))}
      </div>
      {open && <ReadOnlyPopover e={open.e} anchor={open.anchor} onClose={() => setOpen(null)} />}
      {!loading && rows.length === 0 && <div className="note info">Nothing logged this week.</div>}
    </section>
  )
}

function ReadOnlyPopover({ e, anchor, onClose }) {
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect(), w = 280, pad = 12
    const left = r.right + pad + w < window.innerWidth ? r.right + pad : Math.max(8, r.left - pad - w)
    setPos({ top: Math.min(Math.max(8, r.top), window.innerHeight - 220), left })
  }, [anchor])
  useEffect(() => {
    const h = (ev) => { if (!anchor?.contains(ev.target) && !ev.target.closest?.('.pop')) onClose() }
    const k = (ev) => { if (ev.key === 'Escape') onClose() }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [anchor, onClose])
  const start = timeToHours(e.start_time) ?? 9
  return (
    <div className="pop" style={{ top: pos.top, left: pos.left, width: 280 }} role="dialog" aria-label={`${e.project} details`}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="row" style={{ gap: 8, minWidth: 0 }}><span className="swatch" style={{ background: e.colour }} /><div className="col" style={{ gap: 0, minWidth: 0 }}><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.project}</b><span className="tiny muted">{e.client} · {dayName(e.entry_date)} {shortDate(e.entry_date)}</span></div></div>
        <b style={{ fontSize: 18 }}>{fmtHours(e.hours)}</b>
      </div>
      <div className="col small" style={{ gap: 4 }}>
        <span><span className="muted">When</span> · {fmtClock(start)} to {fmtClock(start + e.hours)}</span>
        <span><span className="muted">Work type</span> · {e.work_type || 'Not set'}</span>
        {e.note && <span><span className="muted">Note</span> · {e.note}</span>}
        {e.source !== 'manual' && <span className="tiny muted">{e.source === 'copied' ? 'Copied from a previous week' : 'From Outlook'}</span>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn sm" onClick={onClose}>Close</button></div>
    </div>
  )
}
