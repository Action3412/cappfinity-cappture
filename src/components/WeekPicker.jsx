import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { toISODate, parseISO, addDays, weekStart, today, fmtHours } from '../lib/time.js'
import { ChevronL, ChevronR } from './Icons.jsx'

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Month calendar for picking a week. Each week is a row; each weekday shows a dot
 * coloured by how complete that day is. Click a row to jump to that week.
 */
export default function WeekPicker({ uid, weekStart: ws, dayHours, onPick, onClose }) {
  const [month, setMonth] = useState(() => { const d = parseISO(ws); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [hours, setHours] = useState({})
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [onClose])

  // Weeks that touch this month (Mon-Fri rows)
  const rows = useMemo(() => {
    const first = toISODate(month), last = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0))
    const out = []
    for (let w = weekStart(first); w <= last; w = addDays(w, 7)) out.push([0, 1, 2, 3, 4].map((i) => addDays(w, i)))
    return out
  }, [month])

  useEffect(() => {
    if (!rows.length) return
    const from = rows[0][0], to = rows[rows.length - 1][4]
    supabase.from('time_entries').select('entry_date, hours').eq('profile_id', uid).gte('entry_date', from).lte('entry_date', to)
      .then(({ data }) => { const m = {}; (data || []).forEach((r) => { m[r.entry_date] = (m[r.entry_date] || 0) + Number(r.hours) }); setHours(m) })
  }, [rows, uid])

  const t = today()
  const state = (d) => {
    const h = hours[d] || 0
    if (h >= dayHours) return 'done'
    if (d > t) return h > 0 ? 'part' : 'future'
    return h > 0 ? 'part' : 'short'
  }

  return (
    <div className="wp" ref={ref} role="dialog" aria-label="Choose a week">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronL /></button>
        <b>{MON[month.getMonth()]} {month.getFullYear()}</b>
        <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronR /></button>
      </div>
      <div className="wp-head"><span /> {['M', 'T', 'W', 'T', 'F'].map((d, i) => <span key={i}>{d}</span>)}<span>Total</span></div>
      {rows.map((days) => {
        const w = days[0]
        const tot = days.reduce((a, d) => a + (hours[d] || 0), 0)
        const cur = w === ws, thisWeek = w === weekStart(t)
        return (
          <button key={w} type="button" className={`wp-row ${cur ? 'cur' : ''}`} onClick={() => { onPick(w); onClose() }} aria-label={`Week of ${w}`}>
            <span className="tiny muted" style={{ textAlign: 'left' }}>{thisWeek ? 'Now' : ''}</span>
            {days.map((d) => {
              const inMonth = parseISO(d).getMonth() === month.getMonth()
              return (
                <span key={d} className={`wp-day ${inMonth ? '' : 'dim'} ${d === t ? 'today' : ''}`}>
                  <span>{parseISO(d).getDate()}</span>
                  <i className={`dot ${state(d)}`} />
                </span>
              )
            })}
            <span className={`tiny wp-total ${tot >= dayHours * 5 ? 'ok' : tot > 0 ? 'part' : ''}`}>{tot ? fmtHours(tot) : ''}</span>
          </button>
        )
      })}
      <div className="row" style={{ gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
        <button className="btn sm" onClick={() => { onPick(addDays(weekStart(t), -7)); onClose() }}>Last week</button>
        <button className="btn sm primary" onClick={() => { onPick(weekStart(t)); onClose() }}>This week</button>
      </div>
    </div>
  )
}
