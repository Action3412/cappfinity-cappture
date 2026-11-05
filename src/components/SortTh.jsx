import { useState } from 'react'

/** Sorting state for a table: [key, dir, toggle(key), sortFn] */
export function useSort(defaultKey = null, defaultDir = 'asc') {
  const [key, setKey] = useState(defaultKey)
  const [dir, setDir] = useState(defaultDir)
  const toggle = (k) => { if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setKey(k); setDir('asc') } }
  const sortBy = (rows, getters) => {
    if (!key || !getters[key]) return rows
    const g = getters[key]
    return [...rows].sort((a, b) => {
      const va = g(a), vb = g(b)
      const na = va === null || va === undefined || va === '', nb = vb === null || vb === undefined || vb === ''
      if (na && nb) return 0; if (na) return 1; if (nb) return -1
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' })
      return dir === 'asc' ? c : -c
    })
  }
  return { key, dir, toggle, sortBy }
}

/** A clickable table header. children = label (+ hint). */
export default function SortTh({ k, sort, align, children, style }) {
  const active = sort.key === k
  return (
    <th className={align === 'right' ? 'num' : ''} style={style} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`sort-btn ${active ? 'on' : ''}`} onClick={() => sort.toggle(k)} style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        <span className="row" style={{ gap: 4 }}>{children}</span>
        <svg className="sort-ico" width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
          <path d="M5 1l3.5 4h-7z" fill="currentColor" opacity={active && sort.dir === 'asc' ? 1 : 0.28} />
          <path d="M5 11L1.5 7h7z" fill="currentColor" opacity={active && sort.dir === 'desc' ? 1 : 0.28} />
        </svg>
      </button>
    </th>
  )
}
