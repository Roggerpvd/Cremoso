import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { BarChart3, BookOpen, ChefHat, ListChecks, LogOut, QrCode, ReceiptText, Settings, ShoppingCart, Users } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../lib/settings'
import { APP_NAME } from '../lib/brand'
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

export function AppShell({ children, dark = false, right }: { children: ReactNode; dark?: boolean; right?: ReactNode }) {
  const { profile, can, signOut } = useAuth()
  const { settings } = useSettings()
  return (
    <div className={`flex min-h-screen flex-col ${dark ? 'bg-slate-900 text-slate-100' : ''} print:hidden`}>
      <header className={`sticky top-0 z-30 border-b backdrop-blur-xl ${dark ? 'border-white/10 bg-slate-900/80' : 'border-white/70 bg-white/55'}`}>
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-5">
          <div className="hidden items-center gap-2 sm:flex" title={settings.name}>
            <Logo size={30} />
            <div className="leading-tight">
              <div className={`text-[15px] font-bold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>{APP_NAME}</div>
              {settings.name && settings.name !== APP_NAME && <div className="max-w-40 truncate text-[10px] text-slate-500">{settings.name}</div>}
            </div>
          </div>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {NAV.filter((n) => can(...n.perms)).map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    isActive ? (dark ? 'bg-brand-600 text-white' : 'bg-brand-600 text-white shadow-[0_8px_16px_-8px_rgba(40,69,97,.7)]')
                             : (dark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-white/70')}`}>
                <Icon size={16} /> {label}
              </NavLink>
            ))}
          </nav>
          {right}
          <div className="flex items-center gap-2">
            <span className={`hidden text-xs md:block ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              {profile?.full_name || profile?.email} · {profile?.role_label}
            </span>
            <button onClick={signOut} className={`btn btn-sm ${dark ? 'text-slate-300 hover:bg-white/10' : 'btn-ghost'}`} title="Cerrar sesión">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
