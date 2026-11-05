import { useEffect, useState } from 'react'

const KEY = 'cappture.tour.v1'
export function tourSeen() { try { return localStorage.getItem(KEY) === 'done' } catch { return true } }
export function markTourSeen() { try { localStorage.setItem(KEY, 'done') } catch {} }

const G = (
  <defs>
    <linearGradient id="tour-g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stopColor="#487BFA" /><stop offset=".35" stopColor="#9275FA" /><stop offset=".7" stopColor="#FB6CF5" /><stop offset="1" stopColor="#FDB601" />
    </linearGradient>
  </defs>
)
const S = { fill: 'none', stroke: 'url(#tour-g)', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }

const STEPS = [
  {
    title: 'Drag a project onto your day',
    text: 'Pick it up from the list on the left and drop it at the time you started. It lands as a one-hour block.',
    art: (
      <svg viewBox="0 0 220 120" width="220" height="120" aria-hidden="true">{G}
        <rect x="12" y="22" width="70" height="20" rx="6" {...S} />
        <rect x="12" y="52" width="70" height="20" rx="6" fill="#FB6CF5" opacity=".15" stroke="#FB6CF5" strokeWidth="2" />
        <path d="M90 62c25 0 35-30 60-30" {...S} strokeDasharray="3 5" />
        <path d="M144 26l8 6-8 6" {...S} />
        <rect x="156" y="14" width="52" height="92" rx="10" {...S} />
        <rect x="164" y="44" width="36" height="22" rx="5" fill="#FB6CF5" opacity=".9" />
      </svg>
    ),
  },
  {
    title: 'Pull either end to set the time',
    text: 'Grab the top or bottom edge to make it longer or shorter. Drag the middle to move it, or across to another day.',
    art: (
      <svg viewBox="0 0 220 120" width="220" height="120" aria-hidden="true">{G}
        <rect x="40" y="14" width="52" height="92" rx="10" {...S} />
        <rect x="48" y="30" width="36" height="34" rx="5" fill="#9275FA" opacity=".9" />
        <path d="M66 70v22M60 86l6 6 6-6" {...S} />
        <rect x="128" y="14" width="52" height="92" rx="10" {...S} />
        <rect x="136" y="30" width="36" height="60" rx="5" fill="#9275FA" opacity=".9" />
        <path d="M100 48h20M114 42l6 6-6 6" {...S} />
      </svg>
    ),
  },
  {
    title: 'Click a block to say what it was',
    text: 'Set the work type, add a note, copy it to other days or split it in two. Keep going until the ring on the right completes.',
    art: (
      <svg viewBox="0 0 220 120" width="220" height="120" aria-hidden="true">{G}
        <rect x="20" y="30" width="60" height="30" rx="6" fill="#487BFA" opacity=".9" />
        <rect x="92" y="14" width="112" height="92" rx="12" {...S} />
        <rect x="102" y="28" width="30" height="12" rx="6" fill="#262626" />
        <rect x="136" y="28" width="30" height="12" rx="6" {...S} />
        <rect x="170" y="28" width="24" height="12" rx="6" {...S} />
        <path d="M102 56h92M102 70h60" {...S} strokeDasharray="2 4" />
        <circle cx="186" cy="88" r="9" {...S} />
        <path d="M182 88l3 3 5-6" {...S} />
      </svg>
    ),
  },
]

export default function Tour({ onClose }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') finish(); if (e.key === 'ArrowRight') setI((x) => Math.min(STEPS.length - 1, x + 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)) }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, []) // eslint-disable-line
  function finish() { markTourSeen(); onClose() }
  const s = STEPS[i]
  return (
    <div className="tour-backdrop" onClick={finish}>
      <div className="tour" role="dialog" aria-label="Quick tour" onClick={(e) => e.stopPropagation()}>
        <div className="tour-art">{s.art}</div>
        <div className="col" style={{ gap: 6 }}>
          <span className="tiny muted" style={{ letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700 }}>{i + 1} of {STEPS.length}</span>
          <h2 style={{ fontSize: 20 }}>{s.title}</h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>{s.text}</p>
        </div>
        <div className="row between" style={{ marginTop: 6 }}>
          <button className="btn ghost sm" onClick={finish}>Skip</button>
          <div className="row" style={{ gap: 6 }}>
            <span className="tour-dots" aria-hidden="true">{STEPS.map((_, j) => <i key={j} className={j === i ? 'on' : ''} />)}</span>
            {i < STEPS.length - 1
              ? <button className="btn primary sm" onClick={() => setI(i + 1)}>Next</button>
              : <button className="btn primary sm" onClick={finish}>Let's go</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
