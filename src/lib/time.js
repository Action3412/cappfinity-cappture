// Date helpers. All dates handled as 'YYYY-MM-DD' strings in local time.

export function toISODate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return toISODate(d) }
export function today() { return toISODate(new Date()) }

// Monday of the week containing the date
export function weekStart(s) {
  const d = parseISO(s)
  const dow = (d.getDay() + 6) % 7 // Mon=0
  d.setDate(d.getDate() - dow)
  return toISODate(d)
}
export function weekDays(ws) { return [0, 1, 2, 3, 4].map((i) => addDays(ws, i)) }

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dayName(s) { return DOW[(parseISO(s).getDay() + 6) % 7] }
export function shortDate(s) { const d = parseISO(s); return `${d.getDate()} ${MON[d.getMonth()]}` }
export function longDate(s) { const d = parseISO(s); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
export function weekLabel(ws) {
  const a = parseISO(ws), b = parseISO(addDays(ws, 4))
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MON[a.getMonth()]} ${a.getFullYear()}`
  return `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`
}

export function fmtHours(h) {
  h = Number(h) || 0
  if (h === 0) return '0h'
  const w = Math.floor(h), m = Math.round((h - w) * 60)
  if (m === 0) return `${w}h`
  if (w === 0) return `${m}m`
  return `${w}h ${String(m).padStart(2, '0')}`
}

export function monthRange(d = new Date()) {
  const a = new Date(d.getFullYear(), d.getMonth(), 1), b = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return [toISODate(a), toISODate(b)]
}
export function quarterRange(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3)
  const a = new Date(d.getFullYear(), q * 3, 1), b = new Date(d.getFullYear(), q * 3 + 3, 0)
  return [toISODate(a), toISODate(b)]
}
