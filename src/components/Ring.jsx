export default function Ring({ value, target, size = 150, stroke = 12, children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = target > 0 ? Math.min(1, value / target) : 0
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value} of ${target} hours`}>
        <defs>
          <linearGradient id="ring-spectrum" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#487BFA" /><stop offset="0.35" stopColor="#9275FA" />
            <stop offset="0.7" stopColor="#FB6CF5" /><stop offset="1" stopColor="#FDB601" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ring-spectrum)" strokeWidth={stroke}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`} style={{ transition: 'stroke-dasharray .4s ease' }} />
      </svg>
      <div className="num">{children}</div>
    </div>
  )
}
