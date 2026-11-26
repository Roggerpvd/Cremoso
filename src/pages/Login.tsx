import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import { useSettings } from '../lib/settings'
import { APP_NAME } from '../lib/brand'
import { Logo, Spinner } from '../components/ui'
import { enableStaffInstall } from '../lib/pwa'

export default function Login() {
  const { signIn, session, profile, can } = useAuth()
  const { settings } = useSettings()
  const nav = useNavigate()
  useEffect(() => { enableStaffInstall() }, [])
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (session && profile) return <Navigate to={homeFor(can) ?? '/'} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await signIn(user, password, remember); nav('/', { replace: true }) }
    catch (x) { setErr(errorMessage(x)) }
    finally { setBusy(false) }
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 p-5 lg:grid-cols-[1.2fr_420px] lg:gap-16">
      <div>
        <div className="mb-8 flex items-center gap-2.5">
          <Logo size={36} />
          <span className="text-lg font-bold tracking-tight">{APP_NAME}</span>
        </div>
        <h1 className="display">Pedidos, cocina y caja en un solo lugar.</h1>
        <p className="mt-5 max-w-md text-base text-slate-500">
          Acceso del personal{settings.name && settings.name !== APP_NAME ? ` · ${settings.name}` : ''}. Cada puesto entra con su usuario y ve solo lo que le corresponde.
        </p>
      </div>
      <form onSubmit={submit} className="card w-full space-y-4 p-6 sm:p-8">
        <div>
          <h2 className="text-xl font-bold">Iniciar sesión</h2>
          <p className="text-sm text-slate-500">Usa tu usuario y contraseña.</p>
        </div>
        <div>
          <label className="label" htmlFor="user">Usuario</label>
          <input id="user" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw">Contraseña</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-500">
          <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Mantener la sesión en este equipo (úsalo solo en equipos de un único puesto, p. ej. la tableta de cocina). Si no lo marcas, cada pestaña tiene su propia sesión.</span>
        </label>
        {err && <p className="rounded-xl bg-red-50/80 p-2.5 text-sm text-red-700">{err}</p>}
        <button className="btn btn-primary btn-lg w-full" disabled={busy}>{busy ? <Spinner /> : 'Ingresar'}</button>
      </form>
    </div>
  )
}
