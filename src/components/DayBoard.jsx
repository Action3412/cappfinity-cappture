import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fmtHours, parseDuration, dayName, shortDate, today, timeToHours, hoursToTime, fmtClock } from '../lib/time.js'
import { Check, Calendar } from './Icons.jsx'
import Hint from './Hint.jsx'
import Ring from './Ring.jsx'

export const PX_PER_HOUR = 64
const MIN_H = 0.25
const snapH = (h) => Math.max(MIN_H, Math.round(h * 4) / 4)
const snapT = (t) => Math.round(t * 4) / 4

/** Where a pointer is over the board: the day, its clock range and the snapped time under the pointer. */
export function boardTargetAt(x, y, grabOffsetPx = 0, skipEl = null) {
  const stack = document.elementsFromPoint(x, y)
  for (const el of stack) {
    if (skipEl && skipEl.contains(el)) continue
    const day = el.closest?.('[data-day]')
    if (day) {
      const track = day.querySelector('.track'), r = track.getBoundingClientRect()
      const from = Number(day.getAttribute('data-from'))
      const start = Math.max(0, snapT(from + (y - grabOffsetPx - r.top) / PX_PER_HOUR))
      return { date: day.getAttribute('data-day'), start, track, from, dayEl: day }
    }
  }
  return null
}
export function showGhost(target, hours) {
  document.querySelectorAll('.ghost-block').forEach((n) => n.remove())
  document.querySelectorAll('.day.drop-target').forEach((n) => n.classList.remove('drop-target'))
  if (!target) return
  target.dayEl.classList.add('drop-target')
  const g = document.createElement('div'); g.className = 'ghost-block'
  g.style.top = `${(target.start - target.from) * PX_PER_HOUR}px`; g.style.height = `${Math.max(22, hours * PX_PER_HOUR - 3)}px`
  g.innerHTML = `<span>${fmtClock(target.start)} – ${fmtClock(target.start + hours)}</span>`
  target.track.appendChild(g)
}

/** Assign overlapping entries to side-by-side lanes (like a calendar). Returns { [id]: { lane, lanes } }. */
export function layoutLanes(entries, dayStart) {
  const items = entries.map((e) => ({ id: e.id, s: startOf(e, dayStart), e: startOf(e, dayStart) + e.hours })).sort((a, b) => a.s - b.s || b.e - a.e)
  const out = {}
  let cluster = [], clusterEnd = -1
  const flush = () => {
    if (!cluster.length) return
    const laneEnds = []
    cluster.forEach((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.s + 1e-9)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.e) } else laneEnds[lane] = it.e
      out[it.id] = { lane }
    })
    cluster.forEach((it) => { out[it.id].lanes = laneEnds.length })
    cluster = []; clusterEnd = -1
  }
  items.forEach((it) => {
    if (cluster.length && it.s >= clusterEnd - 1e-9) flush()
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e)
  })
  flush()
  return out
}

export function startOf(e, fallback = 9) { const s = timeToHours(e.start_time); return s === null ? fallback : s }

/** The visible clock range for a day: 9:00 to 17:30 by default, stretched to fit anything outside it. */
export function dayRange(entries, dayStart, dayEnd) {
  let from = dayStart, to = dayEnd
  entries.forEach((e) => { const s = startOf(e, dayStart); from = Math.min(from, Math.floor(s)); to = Math.max(to, Math.ceil(s + e.hours)) })
  return [from, to]
}

/* ------------------------------------------------------------------ */
/* One day column: a clock track. Blocks sit at the time they happened. */
/* ------------------------------------------------------------------ */
export function DayColumn({ date, entries, dayHours, dayStart, dayEnd, range, projById, wtById, isToday, isFirst, editingId, locked, onOpen, onResize, onMove }) {
  const t = today()
  const trackRef = useRef(null)
  const [now, setNow] = useState(() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 })
  useEffect(() => { if (!isToday) return; const i = setInterval(() => { const d = new Date(); setNow(d.getHours() + d.getMinutes() / 60) }, 60000); return () => clearInterval(i) }, [isToday])

  const counts = (e) => projById[e.project_id]?.counts_toward_target !== false
  const tot = entries.reduce((a, e) => a + (counts(e) ? e.hours || 0 : 0), 0)
  const pct = Math.min(100, Math.round((tot / dayHours) * 100))
  const state = tot >= dayHours ? 'done' : date > t ? (tot > 0 ? 'part' : 'future') : tot > 0 ? 'part' : 'short'
  const left = Math.max(0, dayHours - tot)
  const [from, to] = range || dayRange(entries, dayStart, dayEnd)
  const trackH = (to - from) * PX_PER_HOUR
  const hours = []; for (let h = Math.ceil(from); h <= Math.floor(to); h++) hours.push(h)
  const lanes = layoutLanes(entries, dayStart)


  return (
    <section className={`day st-${state} ${isToday ? 'today' : ''}`} data-day={date} data-from={from}>
      <div className="day-progress" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
      <header className="day-head">
        <div className="day-head-row">
          <div className="day-name"><b>{dayName(date)}</b><span>{shortDate(date)}</span>{isToday && <span className="today-pip">Today</span>}</div>
          <div className="day-meter">
            <span className="day-total">{fmtHours(tot)}</span>
            <Ring value={tot} target={dayHours} size={34} stroke={4.5} track="rgba(38,38,38,.08)" className="mini">
              {state === 'done' && <Check width="13" height="13" style={{ color: 'var(--ok)' }} />}
            </Ring>
          </div>
        </div>
        <div className="day-head-row">
          {status(state, left) ? <span className={`day-status ${state}`}>{status(state, left)}</span> : <span className="day-status future">{fmtClock(dayStart)} – {fmtClock(dayEnd)}</span>}
          {isFirst && <Hint size={12} align="left" title="Your day" text={`The column is your working day, ${fmtClock(dayStart)} to ${fmtClock(dayEnd)}, and stretches if you worked outside that. Drop a project at the time you started it, pull either end of the block to set how long, and drag it up or down to move it. Gaps are fine: that's lunch. The number here is hours logged against your ${dayHours}h target. Lunch and breaks can be logged too, they just don't count towards it.`} />}
        </div>
      </header>

      <div className="track" ref={trackRef} style={{ height: trackH }}>
        {hours.map((h) => (
          <span key={h} className={`hour-line ${h === 12 || h === 13 ? 'noon' : ''}`} style={{ top: (h - from) * PX_PER_HOUR }}>{!range && <i>{fmtClock(h)}</i>}</span>
        ))}
        {hours.map((h) => h + 0.5 <= to && <span key={h + 'h'} className="half-line" style={{ top: (h + 0.5 - from) * PX_PER_HOUR }} />)}
        {dayStart > from && <span className="edge-line" style={{ top: (dayStart - from) * PX_PER_HOUR }}>{!range && <i>start</i>}</span>}
        <span className="edge-line" style={{ top: (dayEnd - from) * PX_PER_HOUR }}>{!range && <i>{fmtClock(dayEnd)}</i>}</span>
        {isToday && now >= from && now <= to && <span className="now-line" style={{ top: (now - from) * PX_PER_HOUR }}><i /><em>{fmtClock(Math.floor(now) + Math.round((now % 1) * 60) / 60)}</em></span>}

        {entries.map((e) => (
          <EntryBlock locked={locked} key={e.id} e={e} top={(startOf(e, dayStart) - from) * PX_PER_HOUR} lane={lanes[e.id]} project={projById[e.project_id]} workType={wtById[e.work_type_id]} editing={editingId === e.id}
            onOpen={onOpen} onResize={onResize} onMove={onMove} />
        ))}
      </div>
    </section>
  )
}
/** The shared clock down the left of the board. */
export function TimeGutter({ from, to, dayStart, dayEnd }) {
  const hours = []; for (let h = Math.ceil(from); h <= Math.floor(to); h++) hours.push(h)
  return (
    <div className="gutter" aria-hidden="true">
      <div className="gutter-head" />
      <div className="track" style={{ height: (to - from) * PX_PER_HOUR }}>
        {hours.map((h) => <span key={h} className="gutter-label" style={{ top: (h - from) * PX_PER_HOUR }}>{fmtClock(h)}</span>)}
        <span className="gutter-label edge" style={{ top: (dayEnd - from) * PX_PER_HOUR }}>{fmtClock(dayEnd)}</span>
      </div>
    </div>
  )
}

const status = (state, left) => state === 'done' ? 'Day complete' : state === 'part' ? `${fmtHours(left)} to go` : state === 'short' ? 'Nothing logged yet' : ''

/* ------------------------------------------------------------------ */
/* A block at a clock time. Drag to move (within or between days),     */
/* pull either end to change the time, click to edit.                  */
/* ------------------------------------------------------------------ */
function EntryBlock({ e, top, lane, project, workType, editing, locked, onOpen, onResize, onMove }) {
  const ref = useRef(null)
  const [preview, setPreview] = useState(null)   // { start, hours } while resizing
  const [drag, setDrag] = useState(null)         // { x, y, w, copy } while moving
  const gesture = useRef(null)
  useEffect(() => () => endGesture(), []) // eslint-disable-line

  if (!project) return null
  const start = preview?.start ?? startOf(e)
  const hours = preview?.hours ?? e.hours
  const h = Math.max(22, hours * PX_PER_HOUR - 3)
  const compact = h < 46, tiny = h < 30

  function endGesture() {
    gesture.current = null
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
    document.body.classList.remove('dragging'); showGhost(null)
  }
  function down(ev, mode) {
    if (ev.button !== undefined && ev.button !== 0) return
    ev.stopPropagation(); ev.preventDefault()
    if (locked) { if (mode === 'move') onOpen(e, ref.current); return }
    const r = ref.current.getBoundingClientRect()
    try { ev.currentTarget.setPointerCapture?.(ev.pointerId) } catch {}
    gesture.current = { mode, startX: ev.clientX, startY: ev.clientY, startH: e.hours, startT: startOf(e), moved: false, target: null, copy: ev.altKey, rect: { x: r.left, y: r.top, w: r.width }, grabY: ev.clientY - r.top }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  function move(ev) {
    const g = gesture.current; if (!g) return
    const dx = ev.clientX - g.startX, dy = ev.clientY - g.startY
    if (g.mode === 'resize') {
      g.moved = true
      g.preview = { start: g.startT, hours: snapH(g.startH + dy / PX_PER_HOUR) }
      setPreview(g.preview); return
    }
    if (g.mode === 'resize-top') {
      g.moved = true
      const end = g.startT + g.startH
      const ns = Math.min(end - MIN_H, snapT(g.startT + dy / PX_PER_HOUR))
      g.preview = { start: ns, hours: Math.round((end - ns) * 4) / 4 }
      setPreview(g.preview); return
    }
    if (!g.moved && Math.hypot(dx, dy) < 6) return
    if (!g.moved) document.body.classList.add('dragging')
    g.moved = true; g.copy = ev.altKey
    g.target = boardTargetAt(ev.clientX, ev.clientY, g.grabY, ref.current)
    showGhost(g.target, hours)
    setDrag({ x: g.rect.x + dx, y: g.rect.y + dy, w: g.rect.w, copy: g.copy })
  }
  function up(ev) {
    const g = gesture.current; endGesture(); if (!g) return
    if (g.mode === 'resize' || g.mode === 'resize-top') {
      const p = g.preview; setPreview(null)
      if (g.moved && p && (p.hours !== e.hours || p.start !== startOf(e))) onResize(e, p.hours, p.start)
      return
    }
    setDrag(null)
    if (!g.moved) { onOpen(e, ref.current); return }
    if (g.target) onMove(e, g.target.date, g.target.start, g.copy)
  }

  // Side-by-side lanes when blocks overlap: split the usable width (track minus the 30px time gutter), small gutter between.
  const laneStyle = lane && lane.lanes > 1
    ? { left: `calc(30px + (100% - 33px) * ${lane.lane / lane.lanes})`, right: 'auto', width: `calc((100% - 33px) / ${lane.lanes} - 3px)` }
    : {}
  const style = drag
    ? { position: 'fixed', top: drag.y, left: drag.x, width: drag.w, height: h, right: 'auto', zIndex: 1000, transform: 'scale(1.02)' }
    : { top: preview ? (top + (preview.start - startOf(e)) * PX_PER_HOUR) : top, height: h, zIndex: editing ? 5 : preview ? 6 : undefined, ...laneStyle }

  return (
    <article ref={ref} data-entry={e.id} className={`block ${lane && lane.lanes > 1 ? 'overlap' : ''} ${drag ? 'lifted' : ''} ${preview ? 'resizing' : ''} ${editing ? 'editing' : ''} ${compact ? 'compact' : ''} ${tiny ? 'tiny' : ''}`} style={style}
      onPointerDown={(ev) => down(ev, 'move')} role="button" tabIndex={0}
      aria-label={`${project.name}, ${fmtClock(start)} to ${fmtClock(start + hours)}, ${fmtHours(hours)}. Press Enter to edit.`}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e, ref.current) } }}>
      <span className="block-bar" style={{ background: project.colour }} />
      <div className="block-handle top" onPointerDown={(ev) => down(ev, 'resize-top')} aria-hidden="true"><i /></div>
      <div className="block-body">
        <div className="row between" style={{ gap: 6, alignItems: 'flex-start' }}>
          <div className="col" style={{ gap: 0, minWidth: 0 }}>
            <span className="block-title">{project.name}</span>
            {!compact && <span className="tiny muted block-sub">{fmtClock(start)} – {fmtClock(start + hours)}{workType ? ` · ${workType.name}` : ''}</span>}
          </div>
          <span className={`block-hrs ${preview ? 'live' : ''}`}>{preview ? `${fmtClock(start)} · ${fmtHours(hours)}` : fmtHours(hours)}</span>
        </div>
        {!compact && !tiny && e.note && <p className="block-note">{e.note}</p>}
        {!compact && e.source === 'calendar' && <span className="tiny muted row" style={{ gap: 4 }}><Calendar width="11" height="11" /> Outlook</span>}
      </div>
      {drag?.copy && <span className="block-copy" aria-hidden="true">+</span>}
      <div className="block-handle" onPointerDown={(ev) => down(ev, 'resize')} aria-hidden="true"><i /></div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Floating editor next to a block.                                    */
/* ------------------------------------------------------------------ */
export function EntryPopover({ e, anchor, project, workTypes, chunks, days, locked, onChange, onRemove, onCopy, onSplit, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0, side: 'right' })
  const [note, setNote] = useState(e.note || '')
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const isChunk = chunks.some((c) => Number(c.hours) === e.hours)
  const start = startOf(e)

  useLayoutEffect(() => {
    if (!anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect(), w = 320, pad = 12
      const side = r.right + pad + w < window.innerWidth ? 'right' : 'left'
      const left = side === 'right' ? r.right + pad : Math.max(8, r.left - pad - w)
      const top = Math.min(Math.max(8, r.top), window.innerHeight - 8 - (ref.current?.offsetHeight || 440))
      setPos({ top, left, side })
    }
    place()
    const t = setTimeout(place, 0)
    window.addEventListener('resize', place)
    return () => { clearTimeout(t); window.removeEventListener('resize', place) }
  }, [anchor, e.hours, e.start_time, e.entry_date])
  useEffect(() => { ref.current?.querySelector('button.pill')?.focus({ preventScroll: true }) }, [e.id])
  useEffect(() => {
    const h = (ev) => { if (ref.current && !ref.current.contains(ev.target) && !anchor?.contains(ev.target)) onClose() }
    const k = (ev) => { if (ev.key === 'Escape') onClose() }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [onClose, anchor])
  useEffect(() => { setNote(e.note || ''); if (isChunk) { setText(''); setBad(false) } }, [e.id, e.note, e.hours, isChunk])

  function commitText(v, save = false) {
    setText(v); if (!v.trim()) { setBad(false); return }
    const h = parseDuration(v)
    if (h === null || h <= 0 || h > 24) { setBad(true); return }
    setBad(false)
    if (save && h !== e.hours) onChange({ hours: h })
  }
  function saveNote() { if ((note || '') !== (e.note || '')) onChange({ note: note.trim() || null }) }

  return (
    <div ref={ref} className={`pop ${pos.side} ${locked ? 'locked' : ''}`} style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={`Edit ${project?.name}`}>
      {locked && <div className="note info" style={{ marginBottom: 10 }}>This week has been submitted, so it's locked. Withdraw it from the top of the page if you need to change something.</div>}
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 8, minWidth: 0 }}><span className="swatch" style={{ background: project?.colour }} /><div className="col" style={{ gap: 0, minWidth: 0 }}><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project?.name}</b><span className="tiny muted">{project?.client?.name} · {dayName(e.entry_date)} {shortDate(e.entry_date)}</span></div></div>
        <b style={{ fontSize: 18, whiteSpace: 'nowrap' }}>{fmtHours(e.hours)}</b>
      </div>

      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 110 }}>Starts
          <input className="input" type="time" step="900" style={{ height: 34 }} value={hoursToTime(start)} onChange={(ev) => { const t = timeToHours(ev.target.value); if (t !== null && !Number.isNaN(t)) onChange({ start_time: hoursToTime(t) }) }} />
        </label>
        <label className="field" style={{ width: 110 }}>Ends
          <input className="input" type="time" step="900" style={{ height: 34 }} value={hoursToTime(start + e.hours)} onChange={(ev) => { const t = timeToHours(ev.target.value); if (t !== null && t > start) onChange({ hours: Math.round((t - start) * 4) / 4 }) }} />
        </label>
        <span className="tiny muted desk-only" style={{ paddingBottom: 8 }}>or drag the block</span>
      </div>

      <div className="col" style={{ gap: 6, marginTop: 12 }}>
        <span className="label">How long</span>
        <div className="row wrap" style={{ gap: 6 }}>
          {chunks.map((c) => <button key={c.label} type="button" className={`pill ${Number(c.hours) === e.hours ? 'on' : ''}`} onClick={() => onChange({ hours: Number(c.hours) })}>{c.label}</button>)}
          <input type="text" inputMode="decimal" aria-label="Other duration" placeholder="e.g. 3h 20m" className="input" value={text} onChange={(ev) => commitText(ev.target.value)} onBlur={(ev) => commitText(ev.target.value, true)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitText(ev.currentTarget.value, true) } }}
            style={{ width: 116, height: 30, padding: '0 10px', borderRadius: 999, borderColor: bad ? 'var(--bad)' : !isChunk ? 'var(--charcoal)' : undefined }} />
        </div>
        {bad && <span className="tiny" style={{ color: 'var(--bad)' }}>Try 3h 20m or 3:20</span>}
      </div>

      <div className="col" style={{ gap: 6, marginTop: 12 }}>
        <span className="label">What kind of work</span>
        <div className="row wrap" style={{ gap: 6 }}>
          {workTypes.map((w) => <button key={w.id} type="button" className={`pill ${w.id === e.work_type_id ? 'on violet' : ''}`} onClick={() => onChange({ work_type_id: w.id })}>{w.name}</button>)}
        </div>
      </div>

      <label className="field" style={{ marginTop: 12 }}>Note <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
        <input className="input" style={{ height: 34 }} placeholder="e.g. Scored round-two sifts" value={note} onChange={(ev) => setNote(ev.target.value)} onBlur={saveNote} onKeyDown={(ev) => { if (ev.key === 'Enter') { saveNote(); onClose() } }} />
      </label>

      <div className="col" style={{ gap: 6, marginTop: 12 }}>
        <span className="label">Copy to</span>
        <div className="row wrap" style={{ gap: 6 }}>
          {days.map((d) => <button key={d} type="button" className="pill" disabled={d === e.entry_date} onClick={() => onCopy(e, d)} title={`Copy to ${dayName(d)} at the same time`}>{dayName(d)}</button>)}
          <button type="button" className="pill" onClick={() => onCopy(e, e.entry_date)} title="Copy straight after this one">Duplicate</button>
        </div>
        <span className="tiny muted desk-only">Tip: hold Alt (Option on a Mac) while dragging a block to copy it.</span>
      </div>

      <div className="row between" style={{ marginTop: 14 }}>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm ghost danger" onClick={() => onRemove(e)}>Remove</button>
          {e.hours >= 0.5 && <span className="row" style={{ gap: 4 }}><button className="btn sm ghost" onClick={() => onSplit(e)}>Split</button><Hint size={12} title="Split" text="Cuts this block into two back to back, so you can give each half its own work type (say QA then Analysis). Drag the join between them to wherever you actually switched." /></span>}
        </div>
        <button className="btn sm primary" onClick={() => { saveNote(); onClose() }}>Done</button>
      </div>
    </div>
  )
}
