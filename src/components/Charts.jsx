import { useEffect, useRef, useState } from 'react'

function useWidth(fallback = 640) {
  const ref = useRef(null); const [w, setW] = useState(fallback)
  useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver((es) => setW(Math.max(280, Math.floor(es[0].contentRect.width)))); ro.observe(ref.current); return () => ro.disconnect() }, [])
  return [ref, w]
}
import { fmtHours } from '../lib/time.js'

// Brand-adjacent categorical palette, validated for colour-vision deficiency and contrast. Fixed order.
export const CAT = ['#487BFA', '#B98300', '#6F57D6', '#1F9E8A', '#C94BBE', '#C0602A']
export const BILLABLE = '#487BFA'
export const INTERNAL = 'rgba(255,255,255,.28)'

/* Shared hover tooltip, positioned inside the nearest .chart */
function useTip() {
  const [tip, setTip] = useState(null)
  const show = (ev, data) => { const r = ev.currentTarget.closest('.chart').getBoundingClientRect(); setTip({ x: ev.clientX - r.left, y: ev.clientY - r.top, ...data }) }
  const hide = () => setTip(null)
  const Tip = () => tip && (
    <div className="chart-tip" style={{ left: tip.x + 14, top: tip.y - 8 }}>
      {tip.title && <b>{tip.title}</b>}
      {tip.lines.map(([l, v, c], i) => <div key={i} className="row between" style={{ gap: 14 }}><span className="row" style={{ gap: 6 }}>{c && <i className="dot" style={{ background: c }} />}{l}</span><span className="num">{v}</span></div>)}
    </div>
  )
  return { show, hide, Tip }
}
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10; return m * p }

/* ---------------- Weekly columns on the charcoal card ---------------- */
export function WeeklyColumns({ data, target }) {
  const { show, hide, Tip } = useTip()
  const [wrapRef, W] = useWidth(640)
  const H = 220, padL = 34, padR = 10, padT = 18, padB = 26
  const max = niceMax(Math.max(target || 0, ...data.map((d) => Math.max(d.billable + d.internal, d.target || 0))) * 1.05)
  const iw = W - padL - padR, ih = H - padT - padB
  const n = Math.max(1, data.length)
  const slot = iw / n, bw = Math.min(26, Math.max(10, slot * 0.5))
  const y = (v) => padT + ih - (v / max) * ih
  const ticks = [0, 0.5, 1].map((f) => max * f)
  return (
    <div className="chart" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Hours logged per week, billable and internal" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="col-spectrum" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#487BFA" /><stop offset="0.55" stopColor="#9275FA" /><stop offset="1" stopColor="#FB6CF5" />
          </linearGradient>
        </defs>
        {ticks.map((tv) => <g key={tv}><line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} stroke="rgba(255,255,255,.1)" strokeDasharray={tv ? '2 4' : undefined} /><text x={padL - 8} y={y(tv) + 3.5} textAnchor="end" fontSize="10" fill="rgba(255,255,255,.55)">{tv % 1 ? tv.toFixed(1) : tv}</text></g>)}
        {target > 0 && target <= max && data.every((d) => !d.target || d.target === target) && <g><line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#FDB601" strokeOpacity=".9" strokeDasharray="5 4" /><text x={W - padR} y={y(target) - 6} textAnchor="end" fontSize="10" fontWeight="700" fill="#FDB601">target {target}h</text></g>}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2
          const yb = y(d.billable), yi = y(d.billable + d.internal), tot = d.billable + d.internal
          return (
            <g key={d.label} onMouseMove={(ev) => show(ev, { title: d.label, lines: [['Billable', fmtHours(d.billable), '#9275FA'], ['Internal', fmtHours(d.internal), 'rgba(255,255,255,.5)'], ['Total', fmtHours(tot)], ...(d.target ? [['Target', fmtHours(d.target), '#FDB601'], ['Of target', Math.round((tot / d.target) * 100) + '%']] : [])] })} onMouseLeave={hide}>
              <rect x={padL + i * slot} y={padT} width={slot} height={ih} fill="transparent" />
              {d.billable > 0 && <rect x={x} y={yb} width={bw} height={y(0) - yb} fill="url(#col-spectrum)" rx="4" />}
              {d.internal > 0 && <rect x={x} y={yi} width={bw} height={Math.max(2, yb - yi - 2)} fill={INTERNAL} rx="4" />}
              {d.target > 0 && data.some((o) => o.target !== d.target) && <line x1={x - 6} x2={x + bw + 6} y1={y(Math.min(d.target, max))} y2={y(Math.min(d.target, max))} stroke="#FDB601" strokeDasharray="4 3" strokeOpacity=".9" />}
              {tot > 0 && <text x={x + bw / 2} y={yi - 7} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{tot % 1 ? tot.toFixed(1) : tot}</text>}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,.6)">{d.label}</text>
            </g>
          )
        })}
      </svg>
      <div className="row wrap" style={{ gap: 14, marginTop: 4 }}>
        <span className="row tiny" style={{ gap: 6, opacity: .8 }}><i className="dot" style={{ background: 'linear-gradient(45deg,#487BFA,#9275FA,#FB6CF5)' }} />Billable</span>
        <span className="row tiny" style={{ gap: 6, opacity: .8 }}><i className="dot" style={{ background: 'rgba(255,255,255,.4)' }} />Internal</span>
        {target > 0 && <span className="row tiny" style={{ gap: 6, opacity: .8 }}><i style={{ width: 14, borderTop: '2px dashed #FDB601' }} />Target</span>}
      </div>
      <Tip />
    </div>
  )
}

/* ---------------- Horizontal bars as HTML rows: label · track · value ---------------- */
export function HBars({ data, format = fmtHours, max: maxIn, suffix = '', gradient = 'linear-gradient(90deg, #487BFA, #9275FA)', showShare = false, limit = 8 }) {
  const rows = data.slice(0, limit)
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  const max = maxIn ?? Math.max(...rows.map((d) => d.value), 0.01)
  return (
    <div className="chart hbars">
      {rows.map((d, i) => (
        <div className="hbar" key={d.label} title={d.sub || ''}>
          <span className="hbar-label">{d.label}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${Math.max(1.5, (d.value / max) * 100)}%`, background: i === 0 ? gradient : undefined, opacity: i === 0 ? 1 : 1 - Math.min(0.55, i * 0.08) }} /></span>
          <span className="hbar-val">{format(d.value)}{suffix}{showShare && <span className="muted"> · {Math.round((d.value / total) * 100)}%</span>}</span>
        </div>
      ))}
      {data.length > limit && <span className="tiny muted" style={{ paddingTop: 6 }}>Top {limit} of {data.length}</span>}
      {!rows.length && <span className="small muted">Nothing in this range.</span>}
    </div>
  )
}

/* ---------------- Donut with spectrum-style ring and a proper legend ---------------- */
export function Donut({ data, centreLabel, centreValue }) {
  const { show, hide, Tip } = useTip()
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  const R = 62, stroke = 16, c = 2 * Math.PI * R
  let acc = 0
  const segs = data.map((d) => { const f = d.value / total; const s = { ...d, f, off: acc }; acc += f; return s })
  return (
    <div className="chart row" style={{ gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 160 160" width="156" height="156" role="img" aria-label={`${centreLabel} by category`}>
        <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(38,38,38,.06)" strokeWidth={stroke} />
        <g transform="rotate(-90 80 80)">
          {segs.map((s, i) => s.f > 0 && (
            <circle key={i} cx="80" cy="80" r={R} fill="none" stroke={s.colour} strokeWidth={stroke} strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, s.f * c - 3)} ${c}`} strokeDashoffset={-s.off * c}
              onMouseMove={(ev) => show(ev, { title: s.label, lines: [['Hours', fmtHours(s.value)], ['Share', Math.round(s.f * 100) + '%']] })} onMouseLeave={hide} />
          ))}
        </g>
        <text x="80" y="78" textAnchor="middle" fontSize="22" fontWeight="700" fill="#262626" letterSpacing="-0.5">{centreValue}</text>
        <text x="80" y="96" textAnchor="middle" fontSize="10" fontWeight="600" letterSpacing=".06em" fill="#8A8A94">{String(centreLabel).toUpperCase()}</text>
      </svg>
      <div className="legend-rows">
        {segs.map((s) => (
          <div key={s.label} className="legend-row">
            <span className="row" style={{ gap: 8, minWidth: 0 }}><i className="dot" style={{ background: s.colour }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span></span>
            <span className="num"><b>{Math.round(s.f * 100)}%</b><span className="muted" style={{ marginLeft: 8 }}>{fmtHours(s.value)}</span></span>
          </div>
        ))}
        {!segs.length && <span className="small muted">Nothing in this range.</span>}
      </div>
      <Tip />
    </div>
  )
}

/* ---------------- Heat grid: people × weekdays ---------------- */
export function PersonWeekGrid({ people, days, maxCell }) {
  const { show, hide, Tip } = useTip()
  const max = maxCell || Math.max(1, ...people.flatMap((p) => p.cells))
  return (
    <div className="chart">
      <div className="heat">
        <div className="heat-row head"><span /> {days.map((d) => <span key={d} className="label" style={{ textAlign: 'center', display: 'block' }}>{d}</span>)}<span className="label right" style={{ display: 'block' }}>Total</span></div>
        {people.map((p) => (
          <div className="heat-row" key={p.name}>
            <span className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
            {p.cells.map((h, i) => {
              const f = Math.min(1, h / max)
              return (
                <span key={i} className="heat-cell" style={{ background: h ? `rgba(146,117,250,${0.14 + 0.74 * f})` : 'rgba(38,38,38,.035)', color: f > 0.5 ? '#fff' : '#4A4A55' }}
                  onMouseMove={(ev) => show(ev, { title: `${p.name} · ${days[i]}`, lines: [['Logged', fmtHours(h)]] })} onMouseLeave={hide}>{h ? (h % 1 ? h.toFixed(1) : h) : ''}</span>
              )
            })}
            <span className="small right num" style={{ fontWeight: 700 }}>{fmtHours(p.total)}</span>
          </div>
        ))}
      </div>
      <Tip />
    </div>
  )
}
