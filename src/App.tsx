import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, FullMessage, RequireAuth, homeFor, useAuth } from './auth/AuthProvider'
import { SettingsProvider } from './lib/settings'
import { ToastProvider } from './components/Toast'
import { isConfigured } from './lib/config'
import Login from './pages/Login'
import Pos from './pages/Pos'
import Kitchen from './pages/Kitchen'
import Receipts from './pages/Receipts'
import { PrintHost } from './components/Print'
import Tracking from './pages/Tracking'
import MenuAdmin from './pages/Menu'
import Tables from './pages/Tables'
import Reports from './pages/Reports'
import Users from './pages/Users'
import SettingsPage from './pages/SettingsPage'
import QrMenu from './pages/customer/QrMenu'

function Home() {
  const { can } = useAuth()
  const to = homeFor(can)
  return to ? <Navigate to={to} replace /> : <FullMessage text="Tu rol no tiene pantallas asignadas." />
}

const guard = (perms: string[], el: ReactElement) => <RequireAuth perms={perms}>{el}</RequireAuth>

export default function App() {
  if (!isConfigured) {
    return (
      <FullMessage text="Falta configurar Supabase. Edita public/config.js (o el archivo .env en desarrollo) con la URL del proyecto y la clave anon/publishable. Consulta el README, sección “Puesta en marcha”." />
    )
  }
  return (
    <ToastProvider>
      <SettingsProvider>
        <AuthProvider>
          <Routes>
            <Route path="/m/:token" element={<QrMenu />} />
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
            <Route path="/caja" element={guard(['orders.create', 'payments.register'], <Pos />)} />
            <Route path="/comprobantes" element={guard(['payments.register'], <Receipts />)} />
            <Route path="/cocina" element={guard(['orders.view'], <Kitchen />)} />
            <Route path="/seguimiento" element={guard(['orders.view'], <Tracking />)} />
            <Route path="/carta" element={guard(['menu.manage'], <MenuAdmin />)} />
            <Route path="/mesas" element={guard(['tables.manage'], <Tables />)} />
            <Route path="/reportes" element={guard(['reports.view'], <Reports />)} />
            <Route path="/usuarios" element={guard(['users.manage'], <Users />)} />
            <Route path="/ajustes" element={guard(['settings.manage'], <SettingsPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <PrintHost />
        </AuthProvider>
      </SettingsProvider>
    </ToastProvider>
  )
}
