// Friendly empty states: a small gradient-line illustration and one line of copy.
// kind: 'week' | 'search' | 'projects' | 'people' | 'report' | 'lost'
const G = (
  <defs>
    <linearGradient id="emp-g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stopColor="#487BFA" /><stop offset=".35" stopColor="#9275FA" /><stop offset=".7" stopColor="#FB6CF5" /><stop offset="1" stopColor="#FDB601" />
    </linearGradient>
  </defs>
)
const S = { fill: 'none', stroke: 'url(#emp-g)', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }

export function Illo({ kind, size = 72 }) {
  const common = { width: size, height: size, viewBox: '0 0 72 72', 'aria-hidden': true }
  if (kind === 'week') return (
    <svg {...common}>{G}
      <rect x="10" y="14" width="52" height="46" rx="10" {...S} />
      <path d="M10 28h52M24 8v12M48 8v12" {...S} />
      <rect x="20" y="36" width="14" height="14" rx="4" fill="#FB6CF5" opacity=".9" />
      <path d="M42 43h10" {...S} strokeDasharray="2 4" />
    </svg>
  )
  if (kind === 'search') return (
    <svg {...common}>{G}
      <circle cx="32" cy="32" r="17" {...S} />
      <path d="M45 45l14 14" {...S} />
      <path d="M24 32h16M32 24v16" {...S} strokeDasharray="2 4" />
    </svg>
  )
  if (kind === 'projects') return (
    <svg {...common}>{G}
      <path d="M12 24a6 6 0 0 1 6-6h12l6 6h18a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6z" {...S} />
      <circle cx="36" cy="42" r="3" fill="#FDB601" />
    </svg>
  )
  if (kind === 'people') return (
    <svg {...common}>{G}
      <circle cx="28" cy="26" r="9" {...S} />
      <path d="M10 58c2-10 9-15 18-15s16 5 18 15" {...S} />
      <circle cx="50" cy="28" r="6" {...S} />
      <path d="M62 54c-1-7-5-11-12-11" {...S} />
      <circle cx="56" cy="16" r="3" fill="#FB6CF5" />
    </svg>
  )
  if (kind === 'report') return (
    <svg {...common}>{G}
      <path d="M14 56V20M14 56h46" {...S} />
      <path d="M22 46l10-12 10 8 14-18" {...S} />
      <circle cx="56" cy="24" r="3" fill="#FDB601" />
    </svg>
  )
  return (
    <svg {...common}>{G}
      <circle cx="36" cy="36" r="24" {...S} />
      <path d="M36 22v16l10 6" {...S} />
      <circle cx="36" cy="36" r="2.5" fill="#FB6CF5" />
    </svg>
  )
}

export default function Empty({ kind = 'week', title, text, action, compact = false }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`} role="status">
      <Illo kind={kind} size={compact ? 48 : 72} />
      <div className="col" style={{ gap: 4, alignItems: compact ? 'flex-start' : 'center' }}>
        {title && <b>{title}</b>}
        {text && <span className="small muted" style={{ maxWidth: 360 }}>{text}</span>}
      </div>
      {action}
    </div>
  )
}
