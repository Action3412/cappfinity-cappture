import { useId, useMemo, useState } from 'react'
import { fmtHours } from '../lib/time.js'

// Brand-adjacent categorical palette, validated for colour-vision deficiency and contrast.
// Fixed order: assign by index, never cycle.
export const CAT = ['#3D6FE8', '#B98300', '#6F57D6', '#1F9E8A', '#C94BBE', '#C0602A']
export const BILLABLE = '#3D6FE8'
export const INTERNAL = '#A2A2AB'

function useTip() {
  const [tip, setTip] = useState(null) // { x, y, title, lines: [[label, value, colour?]] }
  const show = (ev, data) => { const r = ev.currentTarget.closest('.chart').getBoundingClientRect(); setTip({ x: ev.clientX - r.left, y: ev.clientY - r.top, ...data }) }
  const hide = () => setTip(null)
  const Tip = () => tip && (
    <div className="chart-tip" style={{ left: Math.min(tip.x + 12, 9999), top: tip.y + 12 }}>
      {tip.title && <b>{tip.title}</b>}
      {tip.lines.map(([l, v, c], i) => <div key={i} className="row between" style={{ gap: 12 }}><span className="row" style={{ gap: 6 }}>{c && <i className="swatch" style={{ background: c, width: 8, height: 8, borderRadius: 2 }} />}{l}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span></div>)}
    </div>
  )
  return { show, hide, Tip }
}

function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10; return m * p }

/* ---------------- Stacked columns: hours per week, billable + internal ---------------- */
export function WeeklyColumns({ data, target }) {
  // data: [{ label, billable, internal }]
  const { show, hide, Tip } = useTip()
  const W = 640, H = 220, padL = 36, padR = 8, padT = 10, padB = 28
  const max = niceMax(Math.max(target || 0, ...data.map((d) => d.billable + d.internal)))
  const iw = W - padL - padR, ih = H - padT - padB
  const n = Math.max(1, data.length)
  const slot = iw / n, bw = Math.min(28, slot * 0.55)
  const y = (v) => padT + ih - (v / max) * ih
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f)
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Hours logged per week, billable and internal">
        {ticks.map((tv) => <g key={tv}><line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} stroke="rgba(38,38,38,.08)" /><text x={padL - 6} y={y(tv) + 3} textAnchor="end" fontSize="10" fill="#8A8A94">{tv % 1 ? tv.toFixed(1) : tv}</text></g>)}
        {target > 0 && target <= max && <g><line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#262626" strokeOpacity=".35" strokeDasharray="4 3" /><text x={W - padR} y={y(target) - 4} textAnchor="end" fontSize="10" fill="#6B6B76">target {target}h</text></g>}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2
          const yb = y(d.billable), yi = y(d.billable + d.internal)
          const tot = d.billable + d.internal
          return (
            <g key={d.label} onMouseMove={(ev) => show(ev, { title: d.label, lines: [['Billable', fmtHours(d.billable), BILLABLE], ['Internal', fmtHours(d.internal), INTERNAL], ['Total', fmtHours(tot)]] })} onMouseLeave={hide}>
              <rect x={padL + i * slot} y={padT} width={slot} height={ih} fill="transparent" />
              {d.billable > 0 && <rect x={x} y={yb} width={bw} height={y(0) - yb} fill={BILLABLE} rx={d.internal > 0 ? 0 : 4} />}
              {d.internal > 0 && <rect x={x} y={yi} width={bw} height={Math.max(0, yb - yi - 2)} fill={INTERNAL} rx="4" />}
              {tot > 0 && <text x={x + bw / 2} y={yi - 5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#4A4A55">{Math.round(tot)}</text>}
              <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="#6B6B76">{d.label}</text>
            </g>
          )
        })}
      </svg>
      <Legend items={[['Billable', BILLABLE], ['Internal', INTERNAL]]} />
      <Tip />
    </div>
  )
}

/* ---------------- Horizontal bars: magnitude by category, single hue ---------------- */
export function HBars({ data, colour = BILLABLE, format = fmtHours, max: maxIn, suffix = '', showPct = false, total }) {
  // data: [{ label, value, sub? }]
  const { show, hide, Tip } = useTip()
  const rows = data.slice(0, 10)
  const max = maxIn ?? niceMax(Math.max(...rows.map((d) => d.value), 0.01))
  const rowH = 30, labelW = 150, W = 520, valW = 64
  const H = rows.length * rowH + 6
  const bx = labelW, bwMax = W - labelW - valW
  return (
    <div className="chart">
      <svg className="hbars" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bar chart">
        {rows.map((d, i) => {
          const yy = i * rowH + 6, w = Math.max(2, (d.value / max) * bwMax)
          return (
            <g key={d.label} onMouseMove={(ev) => show(ev, { title: d.label, lines: [[d.sub || 'Hours', format(d.value) + suffix], ...(showPct && total ? [['Share', Math.round((d.value / total) * 100) + '%']] : [])] })} onMouseLeave={hide}>
              <rect x="0" y={yy - 4} width={W} height={rowH - 2} fill="transparent" />
              <text x={labelW - 10} y={yy + 13} textAnchor="end" fontSize="12" fill="#262626" fontWeight="600">{d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label}</text>
              <rect x={bx} y={yy} width={bwMax} height={18} fill="rgba(38,38,38,.05)" rx="4" />
              <rect x={bx} y={yy} width={w} height={18} fill={d.colour || colour} rx="4" />
              <text x={bx + w + 8} y={yy + 13} fontSize="11" fontWeight="600" fill="#4A4A55" style={{ fontVariantNumeric: 'tabular-nums' }}>{format(d.value)}{suffix}</text>
            </g>
          )
        })}
      </svg>
      {data.length > 10 && <span className="tiny muted">Top 10 shown</span>}
      <Tip />
    </div>
  )
}

/* ---------------- Donut: share of a whole, <= 6 parts, with legend ---------------- */
export function Donut({ data, centreLabel, centreValue }) {
  // data: [{ label, value, colour }]
  const { show, hide, Tip } = useTip()
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  const R = 64, r = 44, C = 2 * Math.PI * ((R + r) / 2)
  let acc = 0
  const segs = data.map((d) => { const f = d.value / total; const s = { ...d, f, off: acc }; acc += f; return s })
  const id = useId()
  return (
    <div className="chart row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label={`${centreLabel} by category`}>
        <g transform="rotate(-90 80 80)">
          {segs.map((s, i) => s.f > 0 && (
            <circle key={i} cx="80" cy="80" r={(R + r) / 2} fill="none" stroke={s.colour} strokeWidth={R - r}
              strokeDasharray={`${Math.max(0, s.f * C - 2)} ${C}`} strokeDashoffset={-s.off * C}
              onMouseMove={(ev) => show(ev, { title: s.label, lines: [['Hours', fmtHours(s.value)], ['Share', Math.round(s.f * 100) + '%']] })} onMouseLeave={hide} />
          ))}
        </g>
        <text x="80" y="76" textAnchor="middle" fontSize="20" fontWeight="700" fill="#262626">{centreValue}</text>
        <text x="80" y="94" textAnchor="middle" fontSize="10" fill="#6B6B76">{centreLabel}</text>
      </svg>
      <div className="col" style={{ gap: 6, flex: 1, minWidth: 150 }}>
        {segs.map((s) => (
          <div key={s.label} className="row between small" style={{ gap: 10 }}>
            <span className="row" style={{ gap: 8 }}><i className="swatch" style={{ background: s.colour, borderRadius: 3 }} />{s.label}</span>
            <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtHours(s.value)} · {Math.round(s.f * 100)}%</span>
          </div>
        ))}
      </div>
      <Tip />
    </div>
  )
}

/* ---------------- Heat strip: hours per person per weekday (small multiples in one grid) ---------------- */
export function PersonWeekGrid({ people, days, maxCell }) {
  // people: [{ name, cells: [h, h, h, h, h], total }]
  const { show, hide, Tip } = useTip()
  const max = maxCell || Math.max(1, ...people.flatMap((p) => p.cells))
  return (
    <div className="chart">
      <div className="heat">
        <div className="heat-row head"><span /> {days.map((d) => <span key={d} className="tiny muted" style={{ textAlign: 'center' }}>{d}</span>)}<span className="tiny muted right">Total</span></div>
        {people.map((p) => (
          <div className="heat-row" key={p.name}>
            <span className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
            {p.cells.map((h, i) => (
              <span key={i} className="heat-cell" style={{ background: h ? `rgba(61,111,232,${0.12 + 0.78 * Math.min(1, h / max)})` : 'rgba(38,38,38,.04)', color: h / max > 0.55 ? '#fff' : '#4A4A55' }}
                onMouseMove={(ev) => show(ev, { title: `${p.name} · ${days[i]}`, lines: [['Logged', fmtHours(h)]] })} onMouseLeave={hide}>{h ? (h % 1 ? h.toFixed(1) : h) : ''}</span>
            ))}
            <span className="small right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(p.total)}</span>
          </div>
        ))}
      </div>
      <Tip />
    </div>
  )
}

export function Legend({ items }) {
  return <div className="row wrap" style={{ gap: 14, marginTop: 6 }}>{items.map(([l, c]) => <span key={l} className="row tiny" style={{ gap: 6, color: 'var(--text-2)' }}><i className="swatch" style={{ background: c, borderRadius: 3 }} />{l}</span>)}</div>
}
