import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import Shell from './components/Shell.jsx'
import Login from './pages/Login.jsx'
import MyWeek from './pages/MyWeek.jsx'
import Reports from './pages/Reports.jsx'
import Admin from './pages/Admin.jsx'
import Pending from './pages/Pending.jsx'

export default function App() {
  const { session, profile, isManager, isAdmin } = useAuth()

  if (session === undefined) return <div className="center">Loading…</div>
  if (!session) return <Login />
  if (profile === null) return <div className="center col" style={{ gap: 10 }}>Setting up your account…<button className="btn sm" onClick={() => window.location.reload()}>Taking too long? Reload</button></div>
  if (!profile.active) return <Pending />

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<MyWeek />} />
        <Route path="/week/:weekStart" element={<MyWeek />} />
        <Route path="/reports" element={isManager ? <Reports /> : <Navigate to="/" replace />} />
        <Route path="/admin/*" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}
