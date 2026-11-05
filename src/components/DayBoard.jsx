import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fmtHours, parseDuration, dayName, shortDate, today } from '../lib/time.js'
import { Check, Plus, Calendar } from './Icons.jsx'
import Hint from './Hint.jsx'

export const PX_PER_HOUR = 64
const MIN_H = 0.25
const snap = (h) => Math.max(MIN_H, Math.round(h * 4) / 4)

/* ------------------------------------------------------------------ */
/* One day column: a time track with blocks stacked top to bottom.     */
/* ------------------------------------------------------------------ */
export function DayColumn({ date, entries, dayHours, projById, wtById, isToday, isFirst, over, editingId, onDropProject, onOpen, onResize, onMove, onCreateAt }) {
  const t = today()
  const tot = entries.reduce((a, e) => a + (e.hours || 0), 0)
  const pct = Math.min(100, Math.round((tot / dayHours) * 100))
  const state = tot >= dayHours ? 'done' : date > t ? (tot > 0 ? 'part' : 'future') : tot > 0 ? 'part' : 'short'
  const left = Math.max(0, dayHours - tot)
  const trackH = Math.max(dayHours, tot) * PX_PER_HOUR
  const hourMarks = []
  for (let i = 1; i < Math.ceil(Math.max(dayHours, tot)); i++) hourMarks.push(i)

  let cursor = 0
  const placed = entries.map((e) => { const top = cursor * PX_PER_HOUR; cursor += e.hours || 0; return { e, top } })

  return (
    <section className={`day st-${state} ${isToday ? 'today' : ''} ${over ? 'over' : ''}`} data-day={date}
      onDragOver={(ev) => { ev.preventDefault(); ev.currentTarget.classList.add('drop-target') }}
      onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove('drop-target') }}
      onDrop={(ev) => { ev.preventDefault(); ev.currentTarget.classList.remove('drop-target'); onDropProject(ev, date) }}>
      <div className="day-progress" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
      <div className="row between" style={{ padding: '2px 6px 6px' }}>
        <div className="row" style={{ gap: 6, alignItems: 'baseline' }}><b>{dayName(date)}</b><span className="small muted">{shortDate(date)}</span>{isToday && <span className="today-pip">Today</span>}</div>
        <span className="small row day-total" style={{ gap: 4, fontWeight: 600 }}>
          {state === 'done' && <Check width="13" height="13" />}{fmtHours(tot)}
          {isFirst && <Hint size={12} align="right" title="Day track" text={`Each block is an entry and its height is the time: the column is ${dayHours} hours tall. Drag a project in, then pull a block's bottom edge to change how long, or drag the whole block onto another day. Click a block to change the work type or add a note.`} />}
        </span>
      </div>

      <div className="track" style={{ height: trackH + 6 }} onDoubleClick={(ev) => { if (ev.target === ev.currentTarget) onCreateAt?.(date) }}>
        {hourMarks.map((h) => <span key={h} className="hour-mark" style={{ top: h * PX_PER_HOUR }}><i>{h}h</i></span>)}
        <span className="target-line" style={{ top: dayHours * PX_PER_HOUR }}><i>{dayHours}h</i></span>

        {left > 0 && (
          <div className="track-free" style={{ top: tot * PX_PER_HOUR + 2, height: left * PX_PER_HOUR - 4 }}>
            <Plus width="16" height="16" />
            <span>{state === 'future' ? 'Drop a project here' : `${fmtHours(left)} to go`}</span>
          </div>
        )}

        {placed.map(({ e, top }) => (
          <EntryBlock key={e.id} e={e} top={top} project={projById[e.project_id]} workType={wtById[e.work_type_id]} editing={editingId === e.id}
            onOpen={onOpen} onResize={onResize} onMove={onMove} />
        ))}
      </div>

      {state === 'done' && <div className="day-status">Done</div>}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* A block. Drag the body to move between days, the bottom edge to     */
/* change its length, click to open the editor.                        */
/* ------------------------------------------------------------------ */
function EntryBlock({ e, top, project, workType, editing, onOpen, onResize, onMove }) {
  const ref = useRef(null)
  const [preview, setPreview] = useState(null)       // hours while resizing
  const [drag, setDrag] = useState(null)             // {dx, dy, overDay} while moving
  const gesture = useRef(null)

  if (!project) return null
  const hours = preview ?? e.hours
  const h = Math.max(22, hours * PX_PER_HOUR - 4)
  const compact = h < 46
  const tiny = h < 30

  function down(ev, mode) {
    if (ev.button !== undefined && ev.button !== 0) return
    ev.stopPropagation()
    gesture.current = { mode, startX: ev.clientX, startY: ev.clientY, startH: e.hours, moved: false, overDay: null }
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
  }
  function move(ev) {
    const g = gesture.current; if (!g) return
    const dx = ev.clientX - g.startX, dy = ev.clientY - g.startY
    if (g.mode === 'resize') {
      g.moved = true
      setPreview(snap(g.startH + dy / PX_PER_HOUR))
      return
    }
    if (!g.moved && Math.hypot(dx, dy) < 6) return
    g.moved = true
    const el = document.elementFromPoint(ev.clientX, ev.clientY)
    const day = el?.closest?.('[data-day]')?.getAttribute('data-day') || null
    g.overDay = day
    setDrag({ dx, dy, overDay: day })
    document.querySelectorAll('.day.drop-target').forEach((n) => n.classList.remove('drop-target'))
    if (day && day !== e.entry_date) document.querySelector(`[data-day="${day}"]`)?.classList.add('drop-target')
  }
  function up(ev) {
    const g = gesture.current; gesture.current = null
    document.querySelectorAll('.day.drop-target').forEach((n) => n.classList.remove('drop-target'))
    if (!g) return
    if (g.mode === 'resize') {
      const nh = snap(g.startH + (ev.clientY - g.startY) / PX_PER_HOUR)
      setPreview(null)
      if (g.moved && nh !== e.hours) onResize(e, nh)
      return
    }
    setDrag(null)
    if (!g.moved) { onOpen(e, ref.current); return }
    if (g.overDay && g.overDay !== e.entry_date) onMove(e, g.overDay)
  }

  const style = {
    top, height: h,
    transform: drag ? `translate(${drag.dx}px, ${drag.dy}px) scale(1.02)` : undefined,
    zIndex: drag ? 20 : editing ? 5 : undefined,
    pointerEvents: drag ? 'none' : undefined,
  }

  return (
    <article ref={ref} className={`block ${drag ? 'lifted' : ''} ${preview !== null ? 'resizing' : ''} ${editing ? 'editing' : ''} ${compact ? 'compact' : ''} ${tiny ? 'tiny' : ''}`} style={style}
      onPointerDown={(ev) => down(ev, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      role="button" tabIndex={0} aria-label={`${project.name}, ${fmtHours(e.hours)}. Click to edit.`}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e, ref.current) } }}>
      <span className="block-bar" style={{ background: project.colour }} />
      <div className="block-body">
        <div className="row between" style={{ gap: 6, alignItems: 'flex-start' }}>
          <div className="col" style={{ gap: 0, minWidth: 0 }}>
            <span className="block-title">{project.name}</span>
            {!compact && <span className="tiny muted block-sub">{project.client?.name}{workType ? ` · ${workType.name}` : ''}</span>}
          </div>
          <span className={`block-hrs ${preview !== null ? 'live' : ''}`}>{fmtHours(hours)}</span>
        </div>
        {!compact && e.note && <p className="block-note">{e.note}</p>}
        {!compact && e.source === 'calendar' && <span className="tiny muted row" style={{ gap: 4 }}><Calendar width="11" height="11" /> Outlook</span>}
      </div>
      <div className="block-handle" onPointerDown={(ev) => down(ev, 'resize')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true"><i /></div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Floating editor next to a block.                                    */
/* ------------------------------------------------------------------ */
export function EntryPopover({ e, anchor, project, workTypes, chunks, onChange, onRemove, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0, side: 'right' })
  const [note, setNote] = useState(e.note || '')
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const isChunk = chunks.some((c) => Number(c.hours) === e.hours)

  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect(), w = 320, pad = 12
    const side = r.right + pad + w < window.innerWidth ? 'right' : 'left'
    const left = side === 'right' ? r.right + pad : Math.max(8, r.left - pad - w)
    const top = Math.min(Math.max(8, r.top), window.innerHeight - 8 - (ref.current?.offsetHeight || 380))
    setPos({ top, left, side })
  }, [anchor])

  useEffect(() => {
    const h = (ev) => { if (ref.current && !ref.current.contains(ev.target) && !anchor?.contains(ev.target)) onClose() }
    const k = (ev) => { if (ev.key === 'Escape') onClose() }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [onClose, anchor])

  useEffect(() => { setNote(e.note || ''); if (isChunk) { setText(''); setBad(false) } }, [e.id, e.note, e.hours, isChunk])

  function commitText(v) {
    setText(v)
    if (!v.trim()) { setBad(false); return }
    const h = parseDuration(v)
    if (h === null || h <= 0 || h > 24) { setBad(true); return }
    setBad(false); onChange({ hours: h })
  }
  function saveNote() { if ((note || '') !== (e.note || '')) onChange({ note: note.trim() || null }) }

  return (
    <div ref={ref} className={`pop ${pos.side}`} style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={`Edit ${project?.name}`}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 8, minWidth: 0 }}><span className="swatch" style={{ background: project?.colour }} /><div className="col" style={{ gap: 0, minWidth: 0 }}><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project?.name}</b><span className="tiny muted">{project?.client?.name} · {dayName(e.entry_date)} {shortDate(e.entry_date)}</span></div></div>
        <b style={{ fontSize: 18, whiteSpace: 'nowrap' }}>{fmtHours(e.hours)}</b>
      </div>

      <div className="col" style={{ gap: 6 }}>
        <span className="label">How long</span>
        <div className="row wrap" style={{ gap: 6 }}>
          {chunks.map((c) => <button key={c.label} type="button" className={`pill ${Number(c.hours) === e.hours ? 'on' : ''}`} onClick={() => onChange({ hours: Number(c.hours) })}>{c.label}</button>)}
          <input type="text" inputMode="decimal" aria-label="Other duration" placeholder="other, e.g. 3h 20m" className="input" value={text} onChange={(ev) => commitText(ev.target.value)}
            style={{ width: 128, height: 30, padding: '0 10px', borderRadius: 999, borderColor: bad ? 'var(--bad)' : !isChunk ? 'var(--charcoal)' : undefined }} />
        </div>
        {bad && <span className="tiny" style={{ color: 'var(--bad)' }}>Try 3h 20m or 3:20</span>}
        <span className="tiny muted">Or drag the bottom edge of the block.</span>
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

      <div className="row between" style={{ marginTop: 14 }}>
        <button className="btn sm ghost danger" onClick={() => onRemove(e)}>Remove</button>
        <button className="btn sm primary" onClick={() => { saveNote(); onClose() }}>Done</button>
      </div>
    </div>
  )
}
