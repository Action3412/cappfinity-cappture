import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Logo } from '../components/Shell.jsx'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function sendLink(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setErr(error.message); else setSent(true)
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
      <div className="login-card">
        <div style={{ color: 'var(--charcoal)' }}><Logo /></div>
        <div className="col" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 22 }}>Log your week in a minute.</h1>
          <p className="muted" style={{ margin: 0 }}>Sign in with your Cappfinity email.</p>
        </div>

        {sent ? (
          <div className="banner ok" style={{ display: 'flex' }}>Check your inbox — we've sent a sign-in link to {email}.</div>
        ) : (
          <form onSubmit={sendLink} className="col" style={{ gap: 10 }}>
            <label className="field">Work email
              <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@cappfinity.com" />
            </label>
            <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            <div className="row" style={{ gap: 10, color: 'var(--muted-2)', fontSize: 12 }}>
              <span className="grow" style={{ height: 1, background: 'var(--line)' }} />or<span className="grow" style={{ height: 1, background: 'var(--line)' }} />
            </div>
            <button type="button" className="btn" onClick={microsoft} style={{ justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="0" y="0" width="7.5" height="7.5" fill="#F25022"/><rect x="8.5" y="0" width="7.5" height="7.5" fill="#7FBA00"/><rect x="0" y="8.5" width="7.5" height="7.5" fill="#00A4EF"/><rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#FFB900"/></svg>
              Continue with Microsoft
            </button>
          </form>
        )}
        {err && <div className="banner warn" style={{ display: 'flex' }}>{err}</div>}
      </div>
    </div>
  )
}
