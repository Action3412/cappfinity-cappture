import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase.js'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)
  const [settings, setSettings] = useState({})

  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*, teams(name)').eq('id', uid).maybeSingle()
    setProfile(data || null)
    const { data: s } = await supabase.from('settings').select('key,value')
    const map = {}
    ;(s || []).forEach((r) => { map[r.key] = r.value })
    setSettings(map)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      loadProfile(data.session?.user?.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null)
      loadProfile(s?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  // Presence heartbeat: every 2 minutes while the tab is open and visible, plus on focus.
  useEffect(() => {
    if (!session?.user) return
    const ping = () => { if (document.visibilityState === 'visible') supabase.rpc('touch_presence').then(() => {}) }
    ping()
    const i = setInterval(ping, 120000)
    window.addEventListener('focus', ping); document.addEventListener('visibilitychange', ping)
    return () => { clearInterval(i); window.removeEventListener('focus', ping); document.removeEventListener('visibilitychange', ping) }
  }, [session?.user?.id])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    settings,
    role: profile?.role ?? 'member',
    isAdmin: profile?.role === 'admin',
    isManager: profile?.role === 'manager' || profile?.role === 'admin',
    weeklyTarget: Number(profile?.weekly_target ?? settings.weekly_target_hours ?? 37.5),
    refreshProfile: () => loadProfile(session?.user?.id),
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
