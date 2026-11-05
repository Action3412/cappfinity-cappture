import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Login() {
  const [mode, setMode] = useState('password') // 'password' | 'link'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function sendLink(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
    })
    setBusy(false)
    if (error) setErr(/signups not allowed|not found/i.test(error.message) ? 'No account for that email yet. Ask an admin to set you up.' : error.message); else setSent(true)
  }

  async function signInPassword(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setErr(error.message === 'Invalid login credentials' ? "That email and password don't match. If you haven't set a password yet, ask an admin for a temporary one." : error.message)
  }

  async function microsoft() {
    setErr('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'email openid profile', redirectTo: window.location.origin },
    })
    if (error) setErr(error.message)
  }

  return (
    <div className="login">
      <div className="login-brand">
        <div className="login-orb" aria-hidden="true"><span /><span /><span /></div>
        <img className="login-mark" src="/brand/icon-dark.svg" alt="" width="84" height="84" draggable="false" />
        <h1 className="login-title">Cappture<span className="dot">.</span></h1>
        <p className="login-tag">Log your week in minutes.<br />See where the time goes.</p>
        <img className="login-lockup" src="/brand/lockup-dark.svg" alt="Cappfinity. Make the best talent decisions." draggable="false" />
      </div>
      <div className="login-card">
        <div className="col" style={{ gap: 4 }}>
          <h2 style={{ fontSize: 22 }}>Sign in</h2>
          <p className="muted" style={{ margin: 0 }}>Use your Cappfinity email.</p>
        </div>

        {sent ? (
          <div className="col" style={{ gap: 10 }}>
            <div className="banner ok" style={{ display: 'flex' }}>Check your inbox. We've sent a sign-in link to {email}.</div>
            <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>Once you're in, set a password from the menu under your name so you can skip the email next time.</p>
            <button className="btn ghost sm" onClick={() => setSent(false)}>Use a different email</button>
          </div>
        ) : (
          <form onSubmit={mode === 'link' ? sendLink : signInPassword} className="col" style={{ gap: 10 }}>
            <label className="field">Work email
              <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@cappfinity.com" autoComplete="username" />
            </label>
            {mode === 'password' && (
              <label className="field">Password
                <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
            )}
            <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center', height: 44 }}>
              {busy ? 'One moment…' : mode === 'link' ? 'Email me a sign-in link' : 'Sign in'}
            </button>
            <button type="button" className="btn ghost sm" style={{ justifyContent: 'center' }} onClick={() => { setMode(mode === 'link' ? 'password' : 'link'); setErr('') }}>
              {mode === 'link' ? 'I have a password' : 'Email me a link instead'}
            </button>
            <div className="row" style={{ gap: 10, color: 'var(--muted-2)', fontSize: 12 }}>
              <span className="grow" style={{ height: 1, background: 'var(--line)' }} />or<span className="grow" style={{ height: 1, background: 'var(--line)' }} />
            </div>
            <button type="button" className="btn" onClick={microsoft} style={{ justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="0" y="0" width="7.5" height="7.5" fill="#F25022"/><rect x="8.5" y="0" width="7.5" height="7.5" fill="#7FBA00"/><rect x="0" y="8.5" width="7.5" height="7.5" fill="#00A4EF"/><rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#FFB900"/></svg>
              Continue with Microsoft
            </button>
            <p className="tiny muted" style={{ margin: 0, textAlign: 'center' }}>First time here? Your admin gives you a temporary password. Set your own once you're in.</p>
          </form>
        )}
        {err && <div className="banner warn" style={{ display: 'flex' }}>{err}</div>}
      </div>
    </div>
  )
}
