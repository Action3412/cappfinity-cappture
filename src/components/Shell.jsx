import { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { supabase } from '../lib/supabase.js'

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
  const { profile, isManager, isAdmin, signOut, refreshProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef(null)
  useEffect(() => { setName(profile?.full_name || '') }, [profile?.full_name])
  const [pw, setPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  async function savePassword(e) {
    e.preventDefault()
    if (pw.length < 10) { setPwMsg('Use at least 10 characters.'); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    setPwMsg(error ? error.message : 'Password set — you can sign in with it next time.')
    if (!error) setPw('')
  }
  async function saveName(e) {
    e.preventDefault()
    const n = name.trim(); if (!n || n === profile?.full_name) return
    await supabase.from('profiles').update({ full_name: n }).eq('id', profile.id)
    refreshProfile()
  }
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
              <form onSubmit={saveName} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', display: 'flex', gap: 6 }}>
                <input className="input" style={{ height: 32 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
                <button className="btn sm" type="submit" style={{ height: 32, width: 'auto', padding: '0 10px' }}>Save</button>
              </form>
              <form onSubmit={savePassword} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="tiny label">Set or change password</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" style={{ height: 32 }} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" aria-label="New password" autoComplete="new-password" />
                  <button className="btn sm" type="submit" style={{ height: 32, width: 'auto', padding: '0 10px' }}>Save</button>
                </div>
                {pwMsg && <span className="tiny" style={{ color: pwMsg.startsWith('Password set') ? 'var(--ok)' : 'var(--bad)' }}>{pwMsg}</span>}
              </form>
              <button onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      {children}
    </>
  )
}
