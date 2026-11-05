import { useAuth } from '../lib/auth.jsx'
import { Logo } from '../components/Shell.jsx'

export default function Pending() {
  const { profile, signOut } = useAuth()
  return (
    <div className="login">
      <div className="login-card">
        <div style={{ color: 'var(--charcoal)' }}><Logo /></div>
        <h1 style={{ fontSize: 20 }}>Nearly there</h1>
        <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
          You're signed in as <b>{profile?.email}</b>, but an admin needs to add you to Cappture before you can log time.
          Ask them to approve you under Admin → People, then refresh this page.
        </p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
