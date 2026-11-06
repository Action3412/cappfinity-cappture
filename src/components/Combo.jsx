import { useEffect, useRef, useState } from 'react'

// A searchable select for long lists (150 people). Type to filter, arrow keys, Enter, Escape.
// options: [{ id, name, sub? }], value: id or 'all', allLabel: label for the 'all' option.
export default function Combo({ options, value, onChange, allLabel = 'Everyone', placeholder = 'Type a name…', ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const ref = useRef(null)
  const inputRef = useRef(null)
  const current = value === 'all' ? null : options.find((o) => o.id === value)
  const list = [{ id: 'all', name: allLabel }, ...options.filter((o) => !q || (o.name + ' ' + (o.sub || '')).toLowerCase().includes(q.toLowerCase()))].slice(0, 60)

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (!ref.current?.contains(e.target)) { setOpen(false); setQ('') } }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [open])
  useEffect(() => { setHi(0) }, [q, open])

  function pick(o) { onChange(o.id); setOpen(false); setQ('') }
  function key(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) pick(list[hi]) }
    else if (e.key === 'Escape') { setOpen(false); setQ('') }
  }

  return (
    <div className={`combo ${open ? 'open' : ''}`} ref={ref}>
      <input ref={inputRef} className="combo-input" role="combobox" aria-expanded={open} aria-label={ariaLabel} aria-autocomplete="list"
        value={open ? q : (current ? current.name : allLabel)} placeholder={placeholder}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onKeyDown={key} />
      {open && (
        <ul className="combo-list" role="listbox">
          {list.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === value} className={`${i === hi ? 'hi' : ''} ${o.id === value ? 'on' : ''}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o) }}>
              <span>{o.name}</span>{o.sub && <span className="tiny muted">{o.sub}</span>}
            </li>
          ))}
          {list.length === 1 && q && <li className="muted small" style={{ cursor: 'default' }}>No one matches "{q}"</li>}
          {options.length > 59 && !q && <li className="tiny muted" style={{ cursor: 'default' }}>Type to search {options.length} people</li>}
        </ul>
      )}
    </div>
  )
}
