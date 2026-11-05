import { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

export function Logo() {
  return (
    <div className="logo">
      <div className="ring"><div>C</div></div>
      <span>Cappture<span className="dot">.</span></span>
    </div>
  )
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?'
}

export default function Shell({ children }) {
  const { profile, isManager, isAdmin, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <>
      <header className="hdr">
        <Logo />
        <nav className="nav">
          <NavLink to="/" end>My week</NavLink>
          {isManager && <NavLink to="/reports">Reports</NavLink>}
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="grow" />
        <div style={{ position: 'relative' }} ref={ref}>
          <button className="hdr-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
            <span className="avatar">{initials(profile?.full_name || profile?.email)}</span>
            <span>{profile?.full_name || profile?.email}</span>
          </button>
          {open && (
            <div className="menu" role="menu">
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }} className="small muted">
                {profile?.email}<br />{profile?.teams?.name || 'No team'} · {profile?.role}
              </div>
              <button onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      {children}
    </>
  )
}
