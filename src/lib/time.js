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

// Understands "3h 20m", "3h20", "3:20", "3.33", "3,5", "200m", "1.5h", "45 mins", "2 hours 10"
// Returns hours as a number (rounded to the nearest minute), or null if it can't be read.
export function parseDuration(input) {
  if (input === null || input === undefined) return null
  const s = String(input).trim().toLowerCase().replace(',', '.')
  if (!s) return null
  let m
  if ((m = s.match(/^(\d{1,2}):([0-5]?\d)$/))) return round(Number(m[1]) + Number(m[2]) / 60)
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/)) && /h|hr|hour/.test(s)) {
    return round(Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0))
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)$/))) return round(Number(m[1]) / 60)
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return round(Number(m[1]))
  if ((m = s.match(/^(\d+)\s*(?:h|hr|hrs|hour|hours)\s*(\d+)$/))) return round(Number(m[1]) + Number(m[2]) / 60)
  return null
  function round(h) { return Math.round(h * 60) / 60 }
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

// "09:15:00" -> 9.25 ; 9.25 -> "09:15"
export function timeToHours(t) { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h + (m || 0) / 60 }
export function hoursToTime(h) { h = Math.max(0, Math.min(23.99, h)); const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` }
export function fmtClock(h) { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${hh}:${String(mm).padStart(2, '0')}` }
