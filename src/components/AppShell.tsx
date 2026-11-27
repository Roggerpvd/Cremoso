import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BarChart3, BookOpen, ChefHat, ListChecks, LogOut, QrCode, ReceiptText, Settings, ShoppingCart, Users } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../lib/settings'
import { APP_NAME } from '../lib/brand'
import { enableStaffInstall } from '../lib/pwa'
import { Logo } from './ui'

const NAV = [
  { to: '/caja', label: 'Caja', icon: ShoppingCart, perms: ['orders.create', 'payments.register'] },
  { to: '/comprobantes', label: 'Comprobantes', icon: ReceiptText, perms: ['payments.register'] },
  { to: '/cocina', label: 'Cocina', icon: ChefHat, perms: ['orders.view'] },
  { to: '/seguimiento', label: 'Seguimiento', icon: ListChecks, perms: ['orders.view'] },
  { to: '/carta', label: 'Carta', icon: BookOpen, perms: ['menu.manage'] },
  { to: '/mesas', label: 'Mesas y QR', icon: QrCode, perms: ['tables.manage'] },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, perms: ['reports.view'] },
  { to: '/usuarios', label: 'Personal', icon: Users, perms: ['users.manage'] },
  { to: '/ajustes', label: 'Ajustes', icon: Settings, perms: ['settings.manage'] },
]

// Posición del indicador de la página anterior: al cambiar de pantalla el indicador DESLIZA desde allí
let lastIndicator: { left: number; width: number } | null = null

export function AppShell({ children, dark = false, plain = false, right }: { children: ReactNode; dark?: boolean; plain?: boolean; right?: ReactNode }) {
  const { profile, can, signOut } = useAuth()
  const { settings } = useSettings()
  const { pathname } = useLocation()
  useEffect(() => { enableStaffInstall() }, [])
  const navRef = useRef<HTMLElement>(null)
  const [ind, setInd] = useState<{ left: number; width: number } | null>(lastIndicator)
  const [slide, setSlide] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
      return el ? { left: el.offsetLeft, width: el.offsetWidth } : null
    }
    const next = measure()
    if (!next) { lastIndicator = null; setInd(null); return }
    if (!lastIndicator) { lastIndicator = next; setInd(next); return }      // primera vez: sin animación
    lastIndicator = next
    // se pinta primero la posición anterior y en el siguiente cuadro se anima hacia la nueva
    const r = requestAnimationFrame(() => requestAnimationFrame(() => { setSlide(true); setInd(next) }))
    return () => cancelAnimationFrame(r)
  }, [pathname, can])

  useEffect(() => {
    const onResize = () => {
      const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
      if (el) { setSlide(false); const n = { left: el.offsetLeft, width: el.offsetWidth }; lastIndicator = n; setInd(n) }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className={`flex min-h-screen flex-col ${dark ? 'bg-slate-900 text-slate-100' : plain ? 'bg-white' : ''} print:hidden`}>
      <header className={`sticky top-0 z-30 border-b backdrop-blur-xl ${dark ? 'border-white/10 bg-slate-900/80' : 'border-white/70 bg-white/55'}`}>
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-5">
          <div className="hidden items-center gap-2 sm:flex" title={settings.name}>
            <Logo size={30} />
            <div className="leading-tight">
              <div className={`text-[15px] font-bold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>{APP_NAME}</div>
              {settings.name && settings.name !== APP_NAME && <div className="max-w-40 truncate text-xs text-slate-600">{settings.name}</div>}
            </div>
          </div>
          <nav ref={navRef} className="relative flex flex-1 gap-1 overflow-x-auto">
            {ind && <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 top-0 rounded-full bg-brand-600 shadow-[0_8px_16px_-8px_rgba(40,69,97,.7)]"
              style={{ width: ind.width, transform: `translateX(${ind.left}px)`, transition: slide ? 'transform 320ms cubic-bezier(0.23,1,0.32,1), width 320ms cubic-bezier(0.23,1,0.32,1)' : 'none' }} />}
            {NAV.filter((n) => can(...n.perms)).map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} title={label} aria-label={label}
                className={({ isActive }) =>
                  `relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-[color,background-color,transform] duration-150 active:scale-[.97] ${
                    isActive ? 'text-white' : (dark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-white/70')}`}>
                {({ isActive }) => (<><Icon size={18} /><span className={isActive ? '' : 'hidden 2xl:inline'}>{label}</span></>)}
              </NavLink>
            ))}
          </nav>
          {right}
          <div className="flex items-center gap-2">
            <span className={`hidden text-xs 2xl:block ${dark ? 'text-slate-500' : 'text-slate-600'}`}>
              {profile?.full_name || profile?.email} · {profile?.role_label}
            </span>
            <button onClick={signOut} className={`btn btn-sm ${dark ? 'text-slate-300 hover:bg-white/10' : 'btn-ghost'}`} title="Cerrar sesión">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
      <main key={pathname} className="page-enter flex-1">{children}</main>
    </div>
  )
}
