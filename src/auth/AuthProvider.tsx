import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase, setPersistSession } from '../lib/supabase'
import { identifierToEmail } from '../lib/config'
import { api } from '../lib/api'
import type { Profile } from '../lib/types'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  can: (...perms: string[]) => boolean
  signIn: (identifier: string, password: string, remember?: boolean) => Promise<void>
  signOut: () => Promise<void>
}
const Ctx = createContext<AuthValue>(null as unknown as AuthValue)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) { setProfile(null); return }
    let alive = true
    setLoading(true)
    api.myProfile()
      .then((p) => { if (alive) setProfile(p) })
      .catch(() => { if (alive) setProfile(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [userId])

  const can = useCallback((...perms: string[]) => {
    if (!profile || !profile.is_active || !profile.role) return false
    if (profile.permissions.includes('*')) return true
    return perms.some((p) => profile.permissions.includes(p))
  }, [profile])

  const value = useMemo<AuthValue>(() => ({
    session, profile, loading, can,
    signIn: async (identifier, password, remember = false) => {
      setPersistSession(remember)
      const { error } = await supabase.auth.signInWithPassword({ email: identifierToEmail(identifier), password })
      if (error) throw error
    },
    signOut: async () => { await supabase.auth.signOut(); setProfile(null) },
  }), [session, profile, loading, can])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const HOME_ORDER: [string, string[]][] = [
  ['/caja', ['orders.create', 'payments.register']],
  ['/cocina', ['orders.kitchen']],
  ['/delivery', ['orders.delivery']],
  ['/seguimiento', ['orders.view']],
  ['/carta', ['menu.manage']],
  ['/mesas', ['tables.manage']],
  ['/reportes', ['reports.view']],
  ['/usuarios', ['users.manage']],
  ['/ajustes', ['settings.manage']],
]

export function homeFor(can: (...p: string[]) => boolean): string | null {
  return HOME_ORDER.find(([, perms]) => can(...perms))?.[0] ?? null
}

/** Protege una ruta: exige sesión y (opcionalmente) alguno de los permisos indicados. */
export function RequireAuth({ perms, children }: { perms?: string[]; children: ReactNode }) {
  const { session, profile, loading, can, signOut } = useAuth()
  const loc = useLocation()
  if (loading) return <FullMessage text="Cargando…" />
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!profile || !profile.is_active || !profile.role) {
    return (
      <FullMessage text="Tu cuenta aún no tiene un rol asignado o está desactivada. Pídele al administrador que la habilite.">
        <button className="btn btn-secondary mt-4" onClick={signOut}>Cerrar sesión</button>
      </FullMessage>
    )
  }
  if (perms && !can(...perms)) {
    const home = homeFor(can)
    return home && home !== loc.pathname ? <Navigate to={home} replace /> : <FullMessage text="No tienes permisos para ver esta pantalla." />
  }
  return <>{children}</>
}

export function FullMessage({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center text-slate-600">
      <p className="max-w-md">{text}</p>
      {children}
    </div>
  )
}
