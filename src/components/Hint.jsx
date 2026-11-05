import { useId, useState, useRef, useEffect } from 'react'

/**
 * A small "i" that explains something. Hover or focus to see it; tap to toggle on touch.
 * Usage: <Hint text="…" /> or <Hint title="Budget" text="…" />
 */
export default function Hint({ text, title, align = 'left', size = 14 }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const k = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  return (
    <span className="hint" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="hint-btn" aria-label={title ? `About ${title}` : 'More information'} aria-describedby={open ? id : undefined} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} style={{ width: size, height: size, fontSize: Math.round(size * 0.68) }}>
        i
      </button>
      {open && (
        <span role="tooltip" id={id} className={`hint-pop ${align}`} onClick={(e) => e.stopPropagation()}>
          {title && <b className="hint-title">{title}</b>}
          {text}
        </span>
      )}
    </span>
  )
}

/** A label followed by a hint, for table headers and field labels. */
export function Labelled({ children, hint, title, align }) {
  return <span className="row" style={{ gap: 5, display: 'inline-flex' }}>{children}{hint && <Hint text={hint} title={title} align={align} />}</span>
}
